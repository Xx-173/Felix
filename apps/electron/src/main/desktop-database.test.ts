import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileStore } from '@finagent/shared';
import { DesktopDatabase } from './desktop-database.ts';
const roots: string[] = [], databases: DesktopDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  Bun.gc(true);
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'felix-desktop-db-test-')) throw new Error('Invalid cleanup boundary');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('desktop SQLite migrates legacy documents once and preserves nested sessions across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'felix-desktop-db-test-')); roots.push(root);
  await mkdir(join(root, 'store'), { recursive: true });
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ watchlist: ['MSFT.US'] }));
  await writeFile(join(root, 'store', 'sessions.json'), JSON.stringify({ title: '中文记录' }));
  await writeFile(join(root, 'credentials.json'), 'OS encrypted credentials');
  const database = await DesktopDatabase.open(root); databases.push(database);
  const store = new JsonFileStore(root), sessions = new JsonFileStore(join(root, 'store'));
  expect(await store.read<unknown>('workspace.json', null)).toEqual({ watchlist: ['MSFT.US'] });
  expect(await sessions.read<unknown>('sessions.json', null)).toEqual({ title: '中文记录' });
  await sessions.write('sessions.json', { title: 'Updated session' });
  await expect(database.write(join(root, '..', 'outside.json'), {})).rejects.toThrow('outside desktop workspace');
  database.close();
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ watchlist: ['AAPL.US'] }));
  const restarted = await DesktopDatabase.open(root); databases.push(restarted);
  expect(await store.read<unknown>('workspace.json', null)).toEqual({ watchlist: ['MSFT.US'] });
  expect(await sessions.read<unknown>('sessions.json', null)).toEqual({ title: 'Updated session' });
  await sessions.remove('sessions.json'); expect(await sessions.read<unknown>('sessions.json', null)).toBeNull();
});
