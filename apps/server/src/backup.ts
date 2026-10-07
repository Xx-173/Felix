import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { assertDataOffline, lockDataDirectory } from './data-lock.ts';
import { WorkspaceDatabase, databaseOptions, type DatabaseOptions, type DatabaseSnapshot } from './database.ts';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function emptyTarget(path: string) {
  try { if ((await readdir(path)).length) throw new Error('Destination must be new or empty; existing data will not be overwritten.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
async function files(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Backup does not follow symbolic links.');
    if (item.isDirectory()) result.push(...await files(root, path));
    else if (item.isFile()) result.push(relative(root, path).split(sep).join('/'));
  }
  return result;
}
function distinct(source: string, destination: string) {
  if (source === destination || destination.startsWith(source + sep) || source.startsWith(destination + sep)) throw new Error('Source and destination must be separate directories.');
}
function entryPath(root: string, name: string) {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep) || name.includes('\\') || name.includes('..') || name.startsWith('/')) throw new Error('Invalid manifest path.');
  return path;
}
const excluded = new Set(['.server-lock', '.database-type', 'felix.sqlite', 'felix.sqlite-wal', 'felix.sqlite-shm', 'backup-manifest.json', 'database-snapshot.json']);

/** Portable application snapshot plus auxiliary files and the effective encryption key. */
export async function backupData(dataDir: string, destination: string, cookieSecret?: string, options: DatabaseOptions = {}) {
  const source = resolve(dataDir), target = resolve(destination); distinct(source, target);
  if (cookieSecret && cookieSecret.length < 32) throw new Error('Cookie secret must contain at least 32 characters.');
  await assertDataOffline(source);
  await emptyTarget(target);
  const unlock = await lockDataDirectory(source);
  let database: WorkspaceDatabase | undefined;
  try {
    database = await WorkspaceDatabase.open(source, options, false);
    const snapshot = Buffer.from(JSON.stringify(await database.snapshot()));
    const entries: Array<{ path: string; sha256: string }> = [];
    for (const name of await files(source)) {
      if (excluded.has(name)) continue;
      const data = await readFile(join(source, name));
      const path = entryPath(target, name);
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
      await writeFile(path, data, { mode: 0o600 });
      entries.push({ path: name, sha256: digest(data) });
    }
    await writeFile(join(target, 'database-snapshot.json'), snapshot, { mode: 0o600 });
    entries.push({ path: 'database-snapshot.json', sha256: digest(snapshot) });
    if (cookieSecret) {
      await writeFile(join(target, '.cookie-signing-key'), cookieSecret, { mode: 0o600 });
      const entry = { path: '.cookie-signing-key', sha256: digest(Buffer.from(cookieSecret)) };
      const index = entries.findIndex((item) => item.path === entry.path);
      if (index >= 0) entries[index] = entry; else entries.push(entry);
    }
    if (!entries.some((entry) => entry.path === '.cookie-signing-key')) throw new Error('Backup requires the effective credential encryption key.');
    await writeFile(join(target, 'backup-manifest.json'), JSON.stringify({ version: 2, database: database.kind, createdAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600 });
    return { files: entries.length };
  } finally { await database?.close(); await unlock(); }
}

/** Restore to a fresh directory and, for PostgreSQL, an empty dedicated database. */
export async function restoreData(backupDir: string, dataDir: string, options: DatabaseOptions = {}) {
  const source = resolve(backupDir), target = resolve(dataDir); distinct(source, target);
  const selected = databaseOptions({ FELIX_DATABASE_TYPE: options.kind, FELIX_DATABASE_URL: options.url });
  await assertDataOffline(target);
  const manifest = JSON.parse(await readFile(join(source, 'backup-manifest.json'), 'utf8'));
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.entries)) throw new Error('Unsupported backup manifest.');
  if (manifest.version === 1 && selected.kind !== 'sqlite') throw new Error('Restore a legacy backup to SQLite first, then create a portable backup to migrate to PostgreSQL.');
  const validated = new Map<string, Uint8Array>();
  for (const entry of manifest.entries) {
    if (typeof entry.path !== 'string' || validated.has(entry.path)) throw new Error('Invalid or duplicate backup entry.');
    const data = await readFile(entryPath(source, entry.path));
    if (digest(data) !== entry.sha256) throw new Error('Backup checksum mismatch.');
    validated.set(entry.path, data);
  }
  const databaseFile = manifest.version === 1 ? 'felix.sqlite' : 'database-snapshot.json';
  if (!validated.has(databaseFile) || !validated.has('.cookie-signing-key')) throw new Error('Backup is missing the database or credential encryption key.');
  if (Buffer.from(validated.get('.cookie-signing-key')!).toString('utf8').length < 32) throw new Error('Invalid credential encryption key in backup.');
  const snapshot = manifest.version === 2 ? JSON.parse(Buffer.from(validated.get(databaseFile)!).toString('utf8')) as DatabaseSnapshot : undefined;
  await emptyTarget(target);
  const unlock = await lockDataDirectory(target);
  let database: WorkspaceDatabase | undefined;
  try {
    for (const [name, data] of validated) {
      if (name === 'database-snapshot.json' || name === '.database-type' || name === '.server-lock' || (manifest.version === 2 && name.startsWith('felix.sqlite'))) continue;
      const path = entryPath(target, name);
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
      await writeFile(path, data, { mode: 0o600 });
    }
    if (snapshot) {
      database = await WorkspaceDatabase.open(target, selected, false);
      await database.restore(snapshot);
    } else {
      const sqlite = new Database(join(target, 'felix.sqlite'), { readonly: true });
      try { if (JSON.stringify(sqlite.query('PRAGMA integrity_check').all()) !== '[{"integrity_check":"ok"}]') throw new Error('Restored database failed integrity check.'); }
      finally { sqlite.close(); }
    }
    return { files: validated.size };
  } finally { await database?.close(); await unlock(); }
}

if (import.meta.main) {
  const [action, source, target] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(action) || !source || !target) throw new Error('Usage: bun apps/server/src/backup.ts backup <data-dir> <new-backup-dir> | restore <backup-dir> <empty-data-dir>');
  const options = databaseOptions(process.env);
  const result = action === 'backup' ? await backupData(source, target, process.env.FELIX_COOKIE_SECRET || undefined, options) : await restoreData(source, target, options);
  console.log(`${action} completed: ${result.files} files. Keep backups private; they include account data and encryption material.`);
}
