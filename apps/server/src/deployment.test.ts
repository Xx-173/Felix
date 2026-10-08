import { afterEach, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { createWebApplication, type ServerOptions } from './app.ts';
import { backupData, restoreData } from './backup.ts';

const roots: string[] = [], apps: Array<Awaited<ReturnType<typeof createWebApplication>>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'felix-deploy-test-')) throw new Error('Invalid test cleanup boundary');
    await rm(root, { recursive: true, force: true });
  }
});
async function directory() { const path = await mkdtemp(join(tmpdir(), 'felix-deploy-test-')); roots.push(path); return path; }
async function start(options: Partial<ServerOptions> = {}) {
  const app = await createWebApplication({ dataDir: await directory(), ...options }); apps.push(app); return app;
}
function client(app: Awaited<ReturnType<typeof createWebApplication>>, address = 'test-address') {
  const jar = new Map<string, string>();
  async function send(endpoint: string, body: unknown) {
    const response = await app.fetch(new Request(`http://localhost/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) }), address);
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';'), index = pair.indexOf('=');
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return await response.json() as { ok: boolean; data: any; error: { code: string } };
  }
  return { jar, rpc: (method: string, ...args: unknown[]) => send('rpc', { method, args }), auth: (action: string, input: unknown = {}) => send('auth', { action, input }) };
}
const password = 'test-password-only-2026';
async function until(read: () => Promise<any>, ready: (result: any) => boolean) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (ready(value)) return value; await Bun.sleep(30); }
  throw new Error('Expected background state did not appear');
}

test('registration claims guest records; login on another browser restores isolated BYOK workspace', async () => {
  const dataDir = await directory(), app = await start({ dataDir });
  const owner = client(app), guest = client(app, 'other-address');
  await owner.rpc('workspace.update', { watchlist: ['MSFT.US', 'MSFT.US'] });
  const session = (await owner.rpc('kernel.createSession', 'Private account')).data;
  await owner.rpc('llm.setCredential', 'deepseek', 'dummy-private-key');
  const oldGuest = owner.jar.get('felix_visitor')!;
  const registered = await owner.auth('register', { username: 'owner', password });
  expect(registered.ok).toBe(true); expect(registered.data.recoveryCode).toHaveLength(43);
  expect(JSON.stringify(registered)).not.toContain('password_hash');
  guest.jar.set('felix_visitor', oldGuest);
  expect((await guest.rpc('kernel.hydrate')).data.sessions).toEqual([]);
  expect((await guest.rpc('workspace.get')).data.watchlist).not.toEqual(['MSFT.US']);
  expect((await guest.auth('login', { username: 'owner', password })).ok).toBe(true);
  expect((await guest.rpc('kernel.hydrate')).data.sessions[0].id).toBe(session.id);
  expect((await guest.rpc('workspace.get')).data.watchlist).toEqual(['MSFT.US']);
  expect((await guest.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  const exported = await guest.rpc('workspace.exportData');
  expect(exported.ok).toBe(true);
  expect(JSON.stringify(exported)).toContain('Private account');
  expect(JSON.stringify(exported)).not.toContain('model-vault');
  await app.close();
  const again = client(await start({ dataDir }));
  expect((await again.auth('login', { username: 'owner', password })).ok).toBe(true);
  expect((await again.rpc('workspace.get')).data.watchlist).toEqual(['MSFT.US']);
  expect((await again.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  const db = new Database(join(dataDir, 'felix.sqlite'), { readonly: true });
  expect(JSON.stringify(db.query('SELECT password_hash FROM users').all())).not.toContain(password);
  db.close();
});

test('watchlist groups persist per account and legacy updates preserve memberships', async () => {
  const dataDir = await directory(), app = await start({ dataDir });
  const owner = client(app), other = client(app, 'other-address');
  const groups = [{ id: 'research', name: '研究中', symbols: ['AAPL.US', 'MSFT.US'] }];
  expect((await owner.rpc('workspace.update', { watchlist: ['AAPL.US', 'MSFT.US'], groups })).ok).toBe(true);
  expect((await other.rpc('workspace.get')).data.groups).toBeUndefined();
  await owner.auth('register', { username: 'group-owner', password });
  await other.auth('login', { username: 'group-owner', password });
  expect((await other.rpc('workspace.get')).data.groups).toEqual(groups);
  await other.rpc('workspace.update', { watchlist: ['MSFT.US'] });
  expect((await other.rpc('workspace.get')).data.groups[0].symbols).toEqual(['MSFT.US']);
  const rejected = await other.rpc('workspace.update', { watchlist: ['MSFT.US'], groups: [{ id: 'bad', name: '', symbols: [] }] });
  expect(rejected.ok).toBe(false);
  expect((await other.rpc('workspace.get')).data.groups[0].name).toBe('研究中');
  await app.close();
  const reopened = client(await start({ dataDir }));
  await reopened.auth('login', { username: 'group-owner', password });
  expect((await reopened.rpc('workspace.get')).data.groups[0]).toEqual({ id: 'research', name: '研究中', symbols: ['MSFT.US'] });
});

test('recovery rotates code, revokes old sessions; password-protected deletion removes workspace and keys', async () => {
  const dataDir = await directory(), app = await start({ dataDir });
  const owner = client(app), recoveryBrowser = client(app, 'recovery-address');
  await owner.rpc('workspace.update', { watchlist: ['TSLA.US'] });
  const registered = await owner.auth('register', { username: 'recover', password });
  const workspaceId = registered.data.user.workspaceId;
  const reset = await recoveryBrowser.auth('resetPassword', { username: 'recover', recoveryCode: registered.data.recoveryCode, newPassword: password + 'new' });
  expect(reset.ok).toBe(true); expect(reset.data.recoveryCode).not.toBe(registered.data.recoveryCode);
  expect((await owner.auth('state')).data.user).toBeNull();
  expect((await owner.auth('resetPassword', { username: 'recover', recoveryCode: registered.data.recoveryCode, newPassword: password })).ok).toBe(false);
  expect((await recoveryBrowser.auth('deleteAccount', { password: 'incorrect-password' })).ok).toBe(false);
  expect((await recoveryBrowser.rpc('workspace.get')).data.watchlist).toEqual(['TSLA.US']);
  const changed = await recoveryBrowser.auth('changePassword', { password: password + 'new', newPassword: password + 'final' });
  expect(changed.ok).toBe(true);
  expect((await recoveryBrowser.auth('deleteAccount', { password: password + 'final' })).data.deleted).toBe(true);
  expect((await recoveryBrowser.auth('state')).data.user).toBeNull();
  expect((await owner.auth('login', { username: 'recover', password: password + 'final' })).ok).toBe(false);
  const db = new Database(join(dataDir, 'felix.sqlite'), { readonly: true });
  expect(db.query('SELECT * FROM documents WHERE key LIKE ?').all(`visitors/${workspaceId}/%`)).toEqual([]);
  expect(db.query('SELECT * FROM auth_sessions').all()).toEqual([]); db.close();
});

test('registration invitation and auth attempts are enforced without exposing user existence', async () => {
  const app = await start({ inviteCode: 'private-invite' }), user = client(app);
  expect((await user.auth('register', { username: 'invited', password })).error.code).toBe('INVITE_REQUIRED');
  expect((await user.auth('register', { username: 'invited', password, inviteCode: 'private-invite' })).ok).toBe(true);
  await user.auth('logout');
  for (let i = 0; i < 10; i++) expect((await user.auth('login', { username: 'unknown', password })).error.code).toBe('INVALID_CREDENTIALS');
  expect((await user.auth('login', { username: 'invited', password })).error.code).toBe('AUTH_RATE_LIMIT');
});

test('legacy JSON workspaces migrate once and scheduled rules execute after restart with no browser', async () => {
  const dataDir = await directory(), id = 'a'.repeat(32), secret = 'test-cookie-secret-at-least-thirty-two';
  await mkdir(join(dataDir, 'visitors', id), { recursive: true });
  await writeFile(join(dataDir, 'visitors', id, 'workspace.json'), JSON.stringify({ watchlist: ['MSFT.US'] }));
  const app = await start({ dataDir, secret }); const user = client(app);
  user.jar.set('felix_visitor', `${id}.${createHmac('sha256', secret).update(id).digest('hex')}`);
  expect((await user.rpc('workspace.get')).data.watchlist).toEqual(['MSFT.US']);
  const rules = (await user.rpc('automation.listRules')).data;
  const rule = { ...rules[0], enabled: true, hour: 0, days: [0, 1, 2, 3, 4, 5, 6], symbols: undefined, strategyId: 'technical' };
  expect((await user.rpc('automation.saveRule', rule)).ok).toBe(true);
  await app.close();
  const restarted = await start({ dataDir, secret, schedulerIntervalMs: 20 });
  // Read SQLite directly; do not reconnect a browser or instantiate a visitor.
  const db = new Database(join(dataDir, 'felix.sqlite'), { readonly: true });
  try {
  const key = `visitors/${id}/automation-runs.json`;
  const runs = await until(async () => { const row = db.query('SELECT value FROM documents WHERE key=?').get(key) as { value: string } | null; return row ? JSON.parse(row.value).runs : []; }, (runs) => runs.length > 0);
  expect(runs[0].scopeSnapshot.symbols).toEqual(['MSFT.US']);
  await restarted.close();
  const again = await start({ dataDir, secret, schedulerIntervalMs: 20 }); await Bun.sleep(100);
  expect(JSON.parse((db.query('SELECT value FROM documents WHERE key=?').get(key) as { value: string }).value).runs).toHaveLength(1);
  expect(db.query('SELECT * FROM scheduled_jobs').all()).toHaveLength(1);
  await again.close();
  } finally { db.close(); }
});

test('selected manual portfolio risk uses its holdings and rejects another visitor portfolio ID', async () => {
  const app = await start(), owner = client(app), other = client(app, 'other-address');
  const draft = (await owner.rpc('portfolioImport.parse', { source: 'csv', text: 'symbol,quantity,cost_price,currency\nMSFT.US,10,100,USD' })).data;
  const portfolio = (await owner.rpc('portfolioImport.confirm', { draft, name: 'My manual holdings' })).data;
  const input = { accountId: `manual:${portfolio.id}` };
  const result = await owner.rpc('portfolioRisk.analyze', input);
  expect(result.ok).toBe(true); expect(result.data.allocation.map((item: any) => item.symbol)).toEqual(['MSFT.US']);
  expect(result.data.capabilityRuns.some((run: any) => run.capabilityId.startsWith('portfolio.'))).toBe(false);
  expect((await other.rpc('portfolioRisk.analyze', input)).error.code).toBe('PORTFOLIO_NOT_FOUND');
});

test('offline backup and restore preserve accounts, messages and encrypted keys and refuse unsafe overwrite', async () => {
  const dataDir = await directory(), backup = await directory(), restored = await directory();
  const app = await start({ dataDir }), user = client(app);
  await user.rpc('kernel.createSession', 'Backed up session');
  await user.rpc('llm.setCredential', 'deepseek', 'dummy-backup-key');
  await user.auth('register', { username: 'backup', password });
  await expect(backupData(dataDir, backup)).rejects.toThrow('in use');
  await expect(createWebApplication({ dataDir })).rejects.toThrow('in use');
  await app.close();
  expect((await backupData(dataDir, backup)).files).toBeGreaterThan(1);
  await expect(restoreData(backup, dataDir)).rejects.toThrow('new or empty');
  expect((await restoreData(backup, restored)).files).toBeGreaterThan(1);
  const newApp = await start({ dataDir: restored }), newUser = client(newApp);
  expect((await newUser.auth('login', { username: 'backup', password })).ok).toBe(true);
  expect((await newUser.rpc('kernel.hydrate')).data.sessions[0].title).toBe('Backed up session');
  expect((await newUser.rpc('llm.getState')).data.model.provider).toBe('deepseek');
  const fresh = await directory();
  await writeFile(join(backup, '.cookie-signing-key'), 'tampered');
  await expect(restoreData(backup, fresh)).rejects.toThrow('checksum');
});


test('a recovery code cannot reset a password twice through concurrent requests', async () => {
  const app = await start(), owner = client(app), first = client(app, 'reset-first'), second = client(app, 'reset-second');
  const registered = await owner.auth('register', { username: 'atomic-recovery', password });
  const recoveryCode = registered.data.recoveryCode;
  const results = await Promise.all([
    first.auth('resetPassword', { username: 'atomic-recovery', recoveryCode, newPassword: password + 'first' }),
    second.auth('resetPassword', { username: 'atomic-recovery', recoveryCode, newPassword: password + 'second' }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)[0].error.code).toBe('INVALID_CREDENTIALS');
});

test('registering a guest closes its existing event streams before account-only data can be emitted', async () => {
  const app = await start(), owner = client(app);
  await owner.rpc('bootstrap');
  const stream = await app.fetch(new Request('http://localhost/api/events', { headers: { Cookie: [...owner.jar].map(([k, v]) => `${k}=${v}`).join('; ') } }));
  const reader = stream.body!.getReader(); await reader.read();
  expect((await owner.auth('register', { username: 'stream-owner', password })).ok).toBe(true);
  expect((await reader.read()).done).toBe(true);
});
