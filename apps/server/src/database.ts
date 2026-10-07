import { SQL, type ReservedSQL } from 'bun';
import { Database } from 'bun:sqlite';
import { access, chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { JsonStoreBackend } from '@finagent/shared';

export type DatabaseKind = 'sqlite' | 'postgresql';
export interface DatabaseOptions { kind?: DatabaseKind; url?: string }
type Row = Record<string, any>;
export interface QueryExecutor {
  query<T extends Row = Row>(statement: string, parameters?: Array<string | number>): Promise<T[]>;
}
interface Connection extends QueryExecutor { close(): Promise<void> }

export function databaseOptions(env: Record<string, string | undefined>): DatabaseOptions {
  const kind = env.FELIX_DATABASE_TYPE || 'sqlite';
  if (kind !== 'sqlite' && kind !== 'postgresql') throw new Error('FELIX_DATABASE_TYPE must be sqlite or postgresql.');
  const url = env.FELIX_DATABASE_URL || undefined;
  if (kind === 'sqlite' && url) throw new Error('FELIX_DATABASE_URL requires FELIX_DATABASE_TYPE=postgresql.');
  if (kind === 'postgresql') {
    if (!url) throw new Error('PostgreSQL requires FELIX_DATABASE_URL.');
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Invalid PostgreSQL connection URL.'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error('Invalid PostgreSQL connection URL.');
  }
  return { kind, url };
}

const schema = [
  'CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)',
  'INSERT INTO schema_version VALUES (1) ON CONFLICT DO NOTHING',
  'CREATE TABLE IF NOT EXISTS scheduled_jobs (workspace_id TEXT NOT NULL, rule_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(workspace_id, rule_id, day))',
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id, expires_at)',
  'CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL)',
];
export const snapshotTables = ['schema_version', 'documents', 'scheduled_jobs', 'users', 'auth_sessions', 'auth_attempts'] as const;
export type DatabaseSnapshot = { version: 1; tables: Record<(typeof snapshotTables)[number], Row[]> };

/** Async transactions and queries share one queue and cannot interleave. */
export class WorkspaceDatabase implements JsonStoreBackend, QueryExecutor {
  private pending: Promise<unknown> = Promise.resolve();
  private closing = false;
  private constructor(readonly root: string, readonly kind: DatabaseKind, private readonly connection: Connection) {}
  static async open(root: string, options: DatabaseOptions = {}, recoverJobs = true) {
    root = resolve(root);
    const validated = databaseOptions({ FELIX_DATABASE_TYPE: options.kind, FELIX_DATABASE_URL: options.url });
    const kind = validated.kind!;
    const marker = join(root, '.database-type');
    try {
      if ((await readFile(marker, 'utf8')).trim() !== kind) throw new Error('Storage type changed. Restore a backup into a new data directory instead of switching existing data silently.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (kind === 'postgresql') {
        let hasSqlite = false;
        try { await access(join(root, 'felix.sqlite')); hasSqlite = true; }
        catch (fileError) { if ((fileError as NodeJS.ErrnoException).code !== 'ENOENT') throw fileError; }
        if (hasSqlite) throw new Error('Existing SQLite data detected. Create a portable backup and restore into PostgreSQL with a new data directory.');
      }
    }
    let connection: Connection;
    if (kind === 'sqlite') {
      const sqlite = new Database(join(root, 'felix.sqlite'), { create: true, strict: true });
      sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      connection = {
        async query<T extends Row>(statement: string, parameters: Array<string | number> = []) { return sqlite.query(statement).all(...parameters) as T[]; },
        async close() { sqlite.close(); },
      };
    } else {
      const pool = new SQL(validated.url!, { max: 1, idleTimeout: 0, maxLifetime: 0, connectionTimeout: 10, bigint: false });
      let client: ReservedSQL;
      try {
        client = await pool.reserve();
        const [lock] = await client.unsafe("SELECT pg_try_advisory_lock(hashtext('felix-single-server-v1')) AS acquired");
        if (!lock?.acquired) throw new Error('PostgreSQL database is in use by another Felix instance.');
      } catch (error) {
        await pool.close({ timeout: 0 });
        if (error instanceof Error && error.message === 'PostgreSQL database is in use by another Felix instance.') throw error;
        throw new Error('Could not connect to PostgreSQL. Check the database URL, network, credentials and TLS configuration.');
      }
      connection = {
        async query<T extends Row>(statement: string, parameters: Array<string | number> = []) { return await client.unsafe(statement, parameters) as T[]; },
        async close() { client.release(); await pool.close({ timeout: 0 }); },
      };
    }
    const database = new WorkspaceDatabase(root, kind, connection);
    try {
      await database.transaction(async (tx) => {
        for (const statement of schema) await tx.query(statement);
        if (recoverJobs) await tx.query("UPDATE scheduled_jobs SET status='interrupted' WHERE status='running'");
      });
      await writeFile(marker, kind, { mode: 0o600 });
      if (kind === 'sqlite') await chmod(join(root, 'felix.sqlite'), 0o600);
      return database;
    } catch (error) { await database.close(); throw error; }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Database is closed.'));
    const result = this.pending.then(work);
    this.pending = result.catch(() => undefined);
    return result;
  }
  query<T extends Row = Row>(statement: string, parameters: Array<string | number> = []): Promise<T[]> {
    return this.serialize(() => this.connection.query<T>(statement, parameters));
  }
  transaction<T>(work: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      await this.connection.query(this.kind === 'sqlite' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try { const result = await work(this.connection); await this.connection.query('COMMIT'); return result; }
      catch (error) { await this.connection.query('ROLLBACK').catch(() => undefined); throw error; }
    });
  }
  private key(path: string) {
    const target = resolve(path);
    if (!target.startsWith(this.root + sep)) throw new Error('Storage path outside workspace');
    return relative(this.root, target).split(sep).join('/');
  }
  async read<T>(path: string, fallback: T): Promise<T> {
    const [row] = await this.query('SELECT value FROM documents WHERE key = $1', [this.key(path)]);
    return row ? JSON.parse(row.value) as T : fallback;
  }
  async write(path: string, data: unknown) {
    await this.query('INSERT INTO documents VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [this.key(path), JSON.stringify(data)]);
  }
  async remove(path: string) { await this.query('DELETE FROM documents WHERE key = $1', [this.key(path)]); }
  async documents(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    return (await this.query('SELECT key, value FROM documents WHERE substr(key, 1, $1) = $2', [prefix.length, prefix])).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }
  async listFiles(directory: string): Promise<string[]> {
    const prefix = this.key(join(directory, '.listing')).slice(0, -'.listing'.length);
    return (await this.documents(prefix)).map((row) => row.key.slice(prefix.length)).filter((name) => !name.includes('/'));
  }
  async removeWorkspace(id: string, tx: QueryExecutor = this) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid workspace identity');
    const prefix = `visitors/${id}/`;
    await tx.query('DELETE FROM documents WHERE substr(key, 1, $1) = $2', [prefix.length, prefix]);
    await tx.query('DELETE FROM scheduled_jobs WHERE workspace_id=$1', [id]);
  }
  async scheduledWorkspaceIds(): Promise<string[]> {
    const rows = await this.query("SELECT key, value FROM documents WHERE key LIKE 'visitors/%/automations.json'");
    return rows.filter((row) => { const value = JSON.parse(row.value); return Array.isArray(value) && value.some((rule) => rule?.enabled); }).map((row) => row.key.split('/')[1]);
  }
  async claimJob(workspaceId: string, ruleId: string, day: string) {
    return (await this.query("INSERT INTO scheduled_jobs VALUES ($1, $2, $3, 'running', $4) ON CONFLICT DO NOTHING RETURNING workspace_id", [workspaceId, ruleId, day, Date.now()])).length === 1;
  }
  async finishJob(workspaceId: string, ruleId: string, day: string, status: 'completed' | 'failed') {
    await this.query('UPDATE scheduled_jobs SET status=$1, updated_at=$2 WHERE workspace_id=$3 AND rule_id=$4 AND day=$5', [status, Date.now(), workspaceId, ruleId, day]);
  }
  async jobErrors(workspaceId: string): Promise<Array<{ status: string; updated_at: number }>> {
    return await this.query("SELECT status, updated_at FROM scheduled_jobs WHERE workspace_id=$1 AND status IN ('failed', 'interrupted') ORDER BY updated_at DESC LIMIT 10", [workspaceId]);
  }
  async migrateFiles() {
    if ((await this.query("SELECT 1 FROM documents WHERE key = '__migration_v2__'")).length) return;
    const legacyMigrated = (await this.query("SELECT 1 FROM documents WHERE key = '__migration_v1__'")).length > 0;
    const entries: Array<[string, string]> = [];
    const walk = async (directory: string) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory() && item.name !== 'backups') await walk(path);
        else if (item.isFile() && item.name.endsWith('.json') && item.name !== 'backup-manifest.json' && item.name !== 'database-snapshot.json' && (!legacyMigrated || item.name === 'skills-state.json' || this.key(path).includes('research/checkpoints/'))) {
          const text = await readFile(path, 'utf8'); JSON.parse(text); entries.push([this.key(path), text]);
        }
      }
    };
    await walk(this.root);
    await this.transaction(async (tx) => {
      for (const [key, value] of entries) await tx.query(legacyMigrated
        ? 'INSERT INTO documents VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
        : 'INSERT INTO documents VALUES ($1, $2) ON CONFLICT DO NOTHING', [key, value]);
      await tx.query("INSERT INTO documents VALUES ('__migration_v1__', $1) ON CONFLICT DO NOTHING", [JSON.stringify({ at: Date.now() })]);
      await tx.query("INSERT INTO documents VALUES ('__migration_v2__', $1) ON CONFLICT DO NOTHING", [JSON.stringify({ at: Date.now() })]);
    });
  }
  async snapshot(): Promise<DatabaseSnapshot> {
    return this.transaction(async (tx) => {
      const tables = {} as DatabaseSnapshot['tables'];
      for (const table of snapshotTables) tables[table] = await tx.query(`SELECT * FROM ${table}`);
      return { version: 1, tables };
    });
  }
  async restore(snapshot: DatabaseSnapshot) {
    if (snapshot.version !== 1 || !snapshot.tables || snapshotTables.some((table) => !Array.isArray(snapshot.tables[table]))) throw new Error('Invalid database snapshot.');
    const columns = {
      schema_version: ['version'], documents: ['key', 'value'], scheduled_jobs: ['workspace_id', 'rule_id', 'day', 'status', 'updated_at'],
      users: ['id', 'username', 'workspace_id', 'password_hash', 'recovery_hash', 'created_at'],
      auth_sessions: ['token_hash', 'user_id', 'expires_at'], auth_attempts: ['key', 'count', 'reset_at'],
    };
    await this.transaction(async (tx) => {
      for (const table of snapshotTables.filter((name) => name !== 'schema_version')) {
        if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).length) throw new Error('Destination database must be empty; existing data will not be overwritten.');
      }
      await tx.query('DELETE FROM schema_version');
      for (const table of snapshotTables) {
        const names = columns[table];
        for (const row of snapshot.tables[table]) {
          const values = names.map((name) => row[name]);
          if (values.some((value) => typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value)))) throw new Error('Invalid database snapshot row.');
          if (table === 'documents') JSON.parse(row.value);
          await tx.query(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')})`, values);
        }
      }
    });
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    await this.pending;
    await this.connection.close();
  }
}
