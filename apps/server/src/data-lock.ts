import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';

type LockOwner = { pid: number; host: string; started?: string };
async function started(pid: number): Promise<string | undefined> {
  if (process.platform !== 'linux') return;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // The comm field can contain spaces and parentheses; field 22 follows it.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
export async function assertDataOffline(root: string) {
  let record: LockOwner;
  try { const raw = await readFile(join(root, '.server-lock'), 'utf8'); const parsed = JSON.parse(raw); record = typeof parsed === 'number' ? { pid: parsed, host: hostname() } : parsed; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!Number.isInteger(record?.pid) || record.pid <= 0) throw new Error('Invalid server lock; inspect it before continuing.');
  if (record.host !== hostname()) throw new Error('Data directory belongs to another host/container. Verify that instance is stopped before removing its stale .server-lock.');
  if (record.started && record.started !== await started(record.pid)) return;
  try { process.kill(record.pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
  throw new Error('Data directory is in use. Stop Felix before backup, restore or another server startup.');
}

export async function lockDataDirectory(root: string): Promise<() => Promise<void>> {
  const path = join(root, '.server-lock');
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await assertDataOffline(root);
    await unlink(path);
    handle = await open(path, 'wx', 0o600);
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), started: await started(process.pid) })); }
  finally { await handle.close(); }
  let released = false;
  return async () => { if (!released) { released = true; await unlink(path); } };
}
