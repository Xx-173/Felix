import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { assertDataOffline } from './data-lock.ts';

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
export async function backupData(dataDir: string, destination: string, cookieSecret?: string) {
  const source = resolve(dataDir), target = resolve(destination); distinct(source, target);
  await assertDataOffline(source);
  await emptyTarget(target);
  const entries: Array<{ path: string; sha256: string }> = [];
  for (const name of await files(source)) {
    if (name === '.server-lock' || name === 'felix.sqlite-wal' || name === 'felix.sqlite-shm') continue;
    let data: Uint8Array;
    if (name === 'felix.sqlite') {
      const db = new Database(join(source, name), { readonly: true });
      try { data = db.serialize(); } finally { db.close(); }
    } else data = await readFile(join(source, name));
    const path = entryPath(target, name);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600 });
    entries.push({ path: name, sha256: digest(data) });
  }
  // A configured environment key overrides the generated key. Store the effective
  // key privately so encrypted BYOK credentials remain decryptable after restore.
  if (cookieSecret) {
    if (cookieSecret.length < 32) throw new Error('Cookie secret must contain at least 32 characters.');
    await writeFile(join(target, '.cookie-signing-key'), cookieSecret, { mode: 0o600 });
    const entry = { path: '.cookie-signing-key', sha256: digest(Buffer.from(cookieSecret)) };
    const index = entries.findIndex((item) => item.path === entry.path);
    if (index >= 0) entries[index] = entry; else entries.push(entry);
  }
  await writeFile(join(target, 'backup-manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600 });
  return { files: entries.length };
}
export async function restoreData(backupDir: string, dataDir: string) {
  const source = resolve(backupDir), target = resolve(dataDir); distinct(source, target);
  await assertDataOffline(target);
  const manifest = JSON.parse(await readFile(join(source, 'backup-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Unsupported backup manifest.');
  const validated = new Map<string, Uint8Array>();
  for (const entry of manifest.entries) {
    if (typeof entry.path !== 'string' || validated.has(entry.path)) throw new Error('Invalid or duplicate backup entry.');
    const data = await readFile(entryPath(source, entry.path));
    if (digest(data) !== entry.sha256) throw new Error('Backup checksum mismatch.');
    validated.set(entry.path, data);
  }
  if (!validated.has('felix.sqlite') || !validated.has('.cookie-signing-key')) throw new Error('Backup is missing the database or credential encryption key.');
  await emptyTarget(target);
  for (const [name, data] of validated) {
    const path = entryPath(target, name);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600 });
  }
  const db = new Database(join(target, 'felix.sqlite'), { readonly: true });
  try { if (JSON.stringify(db.query('PRAGMA integrity_check').all()) !== '[{"integrity_check":"ok"}]') throw new Error('Restored database failed integrity check.'); }
  finally { db.close(); }
  return { files: validated.size };
}

if (import.meta.main) {
  const [action, source, target] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(action) || !source || !target) throw new Error('Usage: bun apps/server/src/backup.ts backup <data-dir> <new-backup-dir> | restore <backup-dir> <empty-data-dir>');
  const result = action === 'backup' ? await backupData(source, target, process.env.FELIX_COOKIE_SECRET || undefined) : await restoreData(source, target);
  console.log(`${action} completed: ${result.files} files. Keep backups private; they include account data and encryption material.`);
}
