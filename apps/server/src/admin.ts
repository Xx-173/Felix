import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkspaceDatabase, databaseOptions } from './database.ts';
import { lockDataDirectory } from './data-lock.ts';
import { setAdministrator } from './accounts.ts';

if (import.meta.main) {
  const [action, username] = process.argv.slice(2);
  if (!['grant', 'revoke'].includes(action) || !username) throw new Error('Usage: bun apps/server/src/admin.ts grant|revoke <registered-username>. Stop the server first.');
  const root = resolve(process.env.FELIX_DATA_DIR ?? resolve(import.meta.dirname, '../../../.felix-web-data'));
  await mkdir(root, { recursive: true });
  const unlock = await lockDataDirectory(root);
  let database: WorkspaceDatabase | undefined;
  try {
    database = await WorkspaceDatabase.open(root, databaseOptions(process.env), false);
    await setAdministrator(database, username, action === 'grant');
    console.log(`Administrator access ${action === 'grant' ? 'granted' : 'revoked'}: ${username.toLowerCase()}`);
  } finally { await database?.close(); await unlock(); }
}
