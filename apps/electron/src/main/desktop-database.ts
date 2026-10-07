import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile, chmod } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { registerJsonStoreBackend, type JsonStoreBackend } from '@finagent/shared';

/** Desktop business documents stay local; credentials retain OS safeStorage. */
export class DesktopDatabase implements JsonStoreBackend {
  private readonly sql: DatabaseSync;
  private unregister?: () => void;
  private closed = false;
  private constructor(private readonly root: string) {
    this.sql = new DatabaseSync(join(root, 'felix.sqlite'));
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }
  static async open(root: string) {
    root = resolve(root);
    await mkdir(root, { recursive: true });
    const database = new DesktopDatabase(root);
    try {
      await database.migrateFiles();
      await chmod(join(root, 'felix.sqlite'), 0o600);
      database.unregister = registerJsonStoreBackend(root, database);
      return database;
    } catch (error) { database.close(); throw error; }
  }
  private key(path: string) {
    const target = resolve(path);
    if (!target.startsWith(this.root + sep)) throw new Error('Storage path outside desktop workspace');
    return relative(this.root, target).split(sep).join('/');
  }
  async read<T>(path: string, fallback: T): Promise<T> {
    const row = this.sql.prepare('SELECT value FROM documents WHERE key = ?').get(this.key(path));
    return row ? JSON.parse(String(row.value)) as T : fallback;
  }
  async write(path: string, data: unknown) {
    this.sql.prepare('INSERT INTO documents VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(this.key(path), JSON.stringify(data));
  }
  async remove(path: string) { this.sql.prepare('DELETE FROM documents WHERE key = ?').run(this.key(path)); }
  async listFiles(directory: string): Promise<string[]> {
    const prefix = this.key(join(directory, '.listing')).slice(0, -'.listing'.length);
    return this.sql.prepare('SELECT key FROM documents WHERE substr(key, 1, ?) = ?').all(prefix.length, prefix)
      .map((row) => String(row.key).slice(prefix.length)).filter((name) => !name.includes('/'));
  }
  private async migrateFiles() {
    if (this.sql.prepare("SELECT 1 FROM documents WHERE key='__desktop_migration_v1__'").get()) return;
    const entries: Array<[string, string]> = [];
    const walk = async (directory: string, nested: boolean) => {
      try {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, item.name);
          // Chromium caches, credentials and Pi transcripts are not document repositories.
          if (item.isDirectory() && (nested || ['store', 'thesis'].includes(item.name))) await walk(path, true);
          else if (item.isFile() && item.name.endsWith('.json') && item.name !== 'credentials.json') {
            const contents = await readFile(path, 'utf8'); JSON.parse(contents); entries.push([this.key(path), contents]);
          }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    };
    await walk(this.root, false);
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.sql.prepare('INSERT INTO documents VALUES (?, ?) ON CONFLICT DO NOTHING');
      for (const [key, value] of entries) insert.run(key, value);
      insert.run('__desktop_migration_v1__', JSON.stringify({ at: Date.now() }));
      this.sql.exec('COMMIT');
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.unregister?.(); this.sql.close();
  }
}
