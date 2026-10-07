import { Database } from 'bun:sqlite';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { JsonStoreBackend } from '@finagent/shared';

/** One server instance owns one transactional SQLite database. */
export class WorkspaceDatabase implements JsonStoreBackend {
  readonly sql: Database;
  constructor(readonly root: string) {
    this.root = resolve(root);
    this.sql = new Database(join(root, 'felix.sqlite'), { create: true, strict: true });
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES (1);
      CREATE TABLE IF NOT EXISTS scheduled_jobs (workspace_id TEXT NOT NULL, rule_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, rule_id, day));
      UPDATE scheduled_jobs SET status='interrupted' WHERE status='running';`);
  }
  private key(path: string) {
    const target = resolve(path);
    if (!target.startsWith(this.root + sep)) throw new Error('Storage path outside workspace');
    return relative(this.root, target).split(sep).join('/');
  }
  async read<T>(path: string, fallback: T): Promise<T> {
    const row = this.sql.query('SELECT value FROM documents WHERE key = ?').get(this.key(path)) as { value: string } | null;
    return row ? JSON.parse(row.value) as T : fallback;
  }
  async write(path: string, data: unknown) { this.sql.query('INSERT INTO documents VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(this.key(path), JSON.stringify(data)); }
  async remove(path: string) { this.sql.query('DELETE FROM documents WHERE key = ?').run(this.key(path)); }
  documents(prefix: string): Array<{ key: string; value: unknown }> {
    return (this.sql.query('SELECT key, value FROM documents WHERE substr(key, 1, ?) = ?').all(prefix.length, prefix) as Array<{ key: string; value: string }>).map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }
  removeWorkspace(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid workspace identity');
    const prefix = `visitors/${id}/`;
    this.sql.query('DELETE FROM documents WHERE substr(key, 1, ?) = ?').run(prefix.length, prefix);
    this.sql.query('DELETE FROM scheduled_jobs WHERE workspace_id=?').run(id);
  }
  scheduledWorkspaceIds(): string[] {
    const rows = this.sql.query("SELECT key, value FROM documents WHERE key GLOB 'visitors/*/automations.json'").all() as Array<{ key: string; value: string }>;
    return rows.filter((row) => { const value = JSON.parse(row.value); return Array.isArray(value) && value.some((rule) => rule?.enabled); }).map((row) => row.key.split('/')[1]);
  }
  claimJob(workspaceId: string, ruleId: string, day: string) {
    return this.sql.query("INSERT OR IGNORE INTO scheduled_jobs VALUES (?, ?, ?, 'running', ?)").run(workspaceId, ruleId, day, Date.now()).changes === 1;
  }
  finishJob(workspaceId: string, ruleId: string, day: string, status: 'completed' | 'failed') {
    this.sql.query('UPDATE scheduled_jobs SET status=?, updated_at=? WHERE workspace_id=? AND rule_id=? AND day=?').run(status, Date.now(), workspaceId, ruleId, day);
  }
  async migrateFiles() {
    if (this.sql.query("SELECT 1 FROM documents WHERE key = '__migration_v1__'").get()) return;
    const entries: Array<[string, string]> = [];
    const walk = async (directory: string) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory() && item.name !== 'backups') await walk(path);
        else if (item.isFile() && item.name.endsWith('.json') && item.name !== 'skills-state.json') {
          const text = await readFile(path, 'utf8'); JSON.parse(text); entries.push([this.key(path), text]);
        }
      }
    };
    await walk(this.root);
    this.sql.transaction(() => {
      const insert = this.sql.query('INSERT OR IGNORE INTO documents VALUES (?, ?)');
      for (const [key, value] of entries) insert.run(key, value);
      insert.run('__migration_v1__', JSON.stringify({ at: Date.now() }));
    })();
    await chmod(join(this.root, 'felix.sqlite'), 0o600);
  }
  close() { this.sql.close(); }
}
