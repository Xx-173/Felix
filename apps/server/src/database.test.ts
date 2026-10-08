import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { WorkspaceDatabase, databaseOptions, type DatabaseOptions } from './database.ts';
import { createWebApplication } from './app.ts';
import { backupData, restoreData } from './backup.ts';
import { setAdministrator } from './accounts.ts';

type App = Awaited<ReturnType<typeof createWebApplication>>;
const password = 'database-test-password-2026';
const postgresUrl = process.env.FELIX_TEST_POSTGRES_URL;
function client(app: App, address = 'test-address', jar = new Map<string, string>()) {
  async function send(endpoint: string, body: unknown) {
    const response = await app.fetch(new Request(`http://localhost/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body),
    }), address);
    for (const header of response.headers.getSetCookie()) { const [pair] = header.split(';'), index = pair.indexOf('='); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
    const result = await response.json() as any;
    return { ...result, httpStatus: response.status };
  }
  return { jar, rpc: (method: string, ...args: unknown[]) => send('rpc', { method, args }), auth: (action: string, input: unknown = {}) => send('auth', { action, input }), admin: (action: string, input?: unknown) => send('admin', { action, input }) };
}

test('storage selection is explicit, validates settings and never leaks a URL', () => {
  expect(databaseOptions({})).toEqual({ kind: 'sqlite', url: undefined });
  expect(databaseOptions({ FELIX_DATABASE_TYPE: 'postgresql', FELIX_DATABASE_URL: 'postgres://test@localhost/felix' }).kind).toBe('postgresql');
  expect(() => databaseOptions({ FELIX_DATABASE_TYPE: 'mysql' })).toThrow('sqlite or postgresql');
  expect(() => databaseOptions({ FELIX_DATABASE_TYPE: 'postgresql' })).toThrow('requires');
  expect(() => databaseOptions({ FELIX_DATABASE_URL: 'postgres://test@localhost/felix' })).toThrow('requires');
  expect(() => databaseOptions({ FELIX_DATABASE_TYPE: 'postgresql', FELIX_DATABASE_URL: 'secret-not-a-url' })).toThrow('Invalid PostgreSQL connection URL.');
});

for (const kind of ['sqlite', 'postgresql'] as const) {
  const suite = kind === 'postgresql' && !postgresUrl ? describe.skip : describe;
  suite(`${kind} storage contract and complete application flows`, () => {
    const roots: string[] = [], apps: App[] = [], connections: WorkspaceDatabase[] = [];
    let options: DatabaseOptions, admin: SQL | undefined, name = '';
    async function directory() { const root = await mkdtemp(join(tmpdir(), 'felix-storage-test-')); roots.push(root); return root; }
    async function start(dataDir: string, extra: object = {}) { const app = await createWebApplication({ dataDir, database: options, ...extra }); apps.push(app); return app; }
    async function open(dataDir: string) { const database = await WorkspaceDatabase.open(dataDir, options); connections.push(database); return database; }
    beforeEach(async () => {
      options = { kind };
      if (kind === 'postgresql') {
        const url = new URL(postgresUrl!);
        if (!url.pathname.startsWith('/felix_test')) throw new Error('PostgreSQL tests require a dedicated felix_test database and a role allowed to create test databases.');
        admin = new SQL(postgresUrl!, { max: 1 });
        name = `felix_test_${randomBytes(8).toString('hex')}`;
        await admin.unsafe(`CREATE DATABASE ${name}`);
        url.pathname = `/${name}`;
        options.url = url.toString();
      }
    });
    afterEach(async () => {
      for (const app of apps.splice(0)) await app.close();
      for (const database of connections.splice(0)) await database.close();
      if (admin) {
        try { await admin.unsafe(`DROP DATABASE ${name}`); }
        finally { await admin.close({ timeout: 0 }); admin = undefined; }
      }
      for (const root of roots.splice(0)) {
        if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'felix-storage-test-')) throw new Error('Invalid cleanup boundary');
        await rm(root, { recursive: true, force: true });
      }
    });
    test('parameterized documents, rollback, concurrent queries and path isolation', async () => {
      const root = await directory(), database = await open(root), path = join(root, 'visitors', 'a'.repeat(32), 'notes.json');
      const note = { text: "中文'; DROP TABLE documents; --", data: [1, true, null] };
      await database.write(path, note);
      expect(await database.read<unknown>(path, null)).toEqual(note);
      await expect(database.write(join(root, '..', 'escape.json'), note)).rejects.toThrow('outside workspace');
      const rollback = database.transaction(async (tx) => {
        await tx.query('INSERT INTO documents VALUES ($1, $2)', ['rollback', '{}']);
        await Bun.sleep(10);
        throw new Error('roll back');
      });
      const independent = database.write(join(root, 'independent.json'), { kept: true });
      await expect(rollback).rejects.toThrow('roll back'); await independent;
      expect((await database.documents('')).some((row) => row.key === 'rollback')).toBe(false);
      expect(await database.read<unknown>(join(root, 'independent.json'), null)).toEqual({ kept: true });
      await database.remove(path); expect(await database.read<unknown>(path, null)).toBeNull();
    });
    test('accounts, encrypted BYOK, skills and research survive restart and isolate users', async () => {
      const root = await directory(), app = await start(root), owner = client(app), other = client(app, 'other-address');
      await owner.rpc('workspace.update', { watchlist: ['MSFT.US'] });
      const session = await owner.rpc('kernel.createSession', '中文研究'); expect(session.ok).toBe(true);
      const research = await owner.rpc('research.start', { symbol: 'AAPL.US', strategyId: 'technical' }); expect(research.ok).toBe(true);
      let reportId: string | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        const run = await owner.rpc('research.getRun', { runId: research.data.id });
        reportId = run.data?.reportId;
        if (reportId) break;
        await Bun.sleep(20);
      }
      expect(reportId).toBeString();
      const skills = (await owner.rpc('skills.list')).data;
      expect((await owner.rpc('skills.setEnabled', skills[0].id, false)).ok).toBe(true);
      // A report can appear before the final checkpoint releases the research queue.
      let registered;
      for (let attempt = 0; attempt < 100; attempt++) {
        registered = await owner.auth('register', { username: 'owner', password });
        if (registered.error?.code !== 'RUN_ACTIVE') break;
        await Bun.sleep(20);
      }
      expect(registered.ok).toBe(true);
      expect((await owner.rpc('llm.setCredential', 'deepseek', 'dummy-storage-key')).ok).toBe(true);
      expect((await other.rpc('kernel.hydrate')).data.sessions).toEqual([]);
      expect((await other.auth('register', { username: 'owner', password })).error.code).toBe('ACCOUNT_EXISTS');
      expect((await other.auth('login', { username: 'owner', password })).ok).toBe(true);
      expect((await other.rpc('workspace.get')).data.watchlist).toEqual(['MSFT.US']);
      const exported = await other.rpc('workspace.exportData'); expect(exported.ok).toBe(true);
      expect(JSON.stringify(exported)).not.toContain('dummy-storage-key');
      await app.close();
      const database = await open(root);
      const snapshot = await database.snapshot();
      expect(snapshot.tables.users[0].created_at).toBeNumber();
      expect(snapshot.tables.documents.some((row) => row.key.includes('research/checkpoints/'))).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain('dummy-storage-key');
      expect(JSON.stringify(snapshot)).not.toContain(password);
      await database.close();
      const again = client(await start(root));
      expect((await again.auth('login', { username: 'owner', password })).ok).toBe(true);
      expect((await again.rpc('kernel.hydrate')).data.sessions[0].id).toBe(session.data.id);
      expect((await again.rpc('llm.getState')).data.model.provider).toBe('deepseek');
      expect((await again.rpc('research.getReport', { reportId })).data.symbol).toBe('AAPL.US');
      expect((await again.rpc('skills.list')).data.find((skill: any) => skill.id === skills[0].id).enabled).toBe(false);
      const changed = await again.auth('changePassword', { password, newPassword: password + '-new' }); expect(changed.ok).toBe(true);
      expect((await again.auth('deleteAccount', { password: password + '-new' })).ok).toBe(true);
      expect((await again.auth('login', { username: 'owner', password: password + '-new' })).ok).toBe(false);
    });
    test('atomic recovery is single use and database-backed auth limits apply', async () => {
      const app = await start(await directory()), owner = client(app), first = client(app, 'first'), second = client(app, 'second');
      const registered = await owner.auth('register', { username: 'recovery', password });
      const results = await Promise.all([
        first.auth('resetPassword', { username: 'recovery', recoveryCode: registered.data.recoveryCode, newPassword: password + '-first' }),
        second.auth('resetPassword', { username: 'recovery', recoveryCode: registered.data.recoveryCode, newPassword: password + '-second' }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect((await owner.auth('state')).data.user).toBeNull();
      const limited = client(app, 'limited');
      for (let i = 0; i < 10; i++) expect((await limited.auth('login', { username: 'unknown', password })).error.code).toBe('INVALID_CREDENTIALS');
      expect((await limited.auth('login', { username: 'unknown', password })).error.code).toBe('AUTH_RATE_LIMIT');
    });
    test('administrator settings enforce roles, validate domains and update existing visitors without restart', async () => {
      const root = await directory(), first = await start(root), owner = client(first);
      const registration = await owner.auth('register', { username: 'operator', password, role: 'admin' });
      expect(registration.data.user.role).toBe('user');
      expect((await owner.admin('getSettings')).httpStatus).toBe(403);
      expect((await owner.auth('grantAdministrator', { username: 'operator' })).ok).toBe(false);
      await first.close();
      const database = await open(root);
      await setAdministrator(database, 'OPERATOR', true); await database.close();
      const app = await start(root, { modelAllowedHosts: ['fixed.example.com'] });
      const admin = client(app, 'admin-address', owner.jar), guest = client(app, 'guest-address');
      expect((await admin.auth('state')).data.user.role).toBe('admin');
      const ordinary = await guest.auth('register', { username: 'ordinary', password, role: 'admin' });
      expect(ordinary.data.user.role).toBe('user');
      expect((await guest.admin('saveSettings', { revision: 0, modelAllowedHosts: ['evil.example.com'] })).httpStatus).toBe(403);
      expect((await client(app, 'anonymous-address').admin('getSettings')).error.code).toBe('ADMIN_REQUIRED');
      const config = { name: 'agnes', displayName: 'Agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'dummy-admin-domain-key', models: [{ id: 'agnes-3.0-flash', name: 'Agnes' }] };
      expect((await guest.rpc('llm.setCustomProvider', config)).error.code).toBe('MODEL_ENDPOINT_NOT_ALLOWED');
      const state = (await admin.admin('getSettings')).data;
      expect(state.revision).toBe(0); expect(state.environmentHosts).toEqual(['fixed.example.com']);
      const crossSite = await app.fetch(new Request('http://localhost/api/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example.com', Cookie: [...admin.jar].map(([key, value]) => `${key}=${value}`).join('; ') },
        body: JSON.stringify({ action: 'saveSettings', input: { revision: 0, modelAllowedHosts: ['evil.example.com'] } }),
      }));
      expect(crossSite.status).toBe(403);
      for (const invalid of ['http://example.com', '127.0.0.1', 'localhost', 'service.internal', '*.example.com', 'example.com/v1', 'example.com:443']) {
        expect((await admin.admin('saveSettings', { revision: 0, modelAllowedHosts: [invalid] })).error.code).toBe('INVALID_ARGUMENT');
      }
      const saved = await admin.admin('saveSettings', { revision: 0, modelAllowedHosts: ['APIHUB.AGNES-AI.COM', 'apihub.agnes-ai.com'] });
      expect(saved.ok).toBe(true); expect(saved.data.modelAllowedHosts).toEqual(['apihub.agnes-ai.com']);
      expect((await guest.rpc('llm.setCustomProvider', config)).ok).toBe(true);
      expect((await guest.rpc('llm.setModel', 'agnes', 'agnes-3.0-flash')).ok).toBe(true);
      expect(JSON.stringify(await admin.admin('getSettings'))).not.toContain('dummy-admin-domain-key');
      expect((await admin.admin('saveSettings', { revision: 0, modelAllowedHosts: [] })).httpStatus).toBe(409);
      expect((await admin.admin('saveSettings', { revision: 1, modelAllowedHosts: [] })).ok).toBe(true);
      expect((await guest.rpc('llm.setModel', 'agnes', 'agnes-3.0-flash')).error.code).toBe('MODEL_ENDPOINT_NOT_ALLOWED');
      expect((await admin.auth('deleteAccount', { password })).error.code).toBe('ADMIN_ACCOUNT_DELETE_FORBIDDEN');
      await app.close();
      const again = await start(root), resumed = client(again, 'resumed', owner.jar);
      expect((await resumed.auth('state')).data.user.role).toBe('admin');
      expect((await resumed.admin('getSettings')).data.revision).toBe(2);
      await again.close();
      const reopened = await open(root); await setAdministrator(reopened, 'operator', false); await reopened.close();
      const revoked = client(await start(root), 'revoked', owner.jar);
      expect((await revoked.admin('getSettings')).httpStatus).toBe(403);
    });
    test('job claims are atomic and failed/interrupted records survive restart', async () => {
      const root = await directory(), database = await open(root), id = 'b'.repeat(32);
      const claims = await Promise.all([database.claimJob(id, 'rule', '2026-10-07'), database.claimJob(id, 'rule', '2026-10-07')]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await database.close();
      const again = await open(root);
      expect((await again.jobErrors(id))[0].status).toBe('interrupted');
      expect((await again.jobErrors(id))[0].updated_at).toBeNumber();
      expect(await again.claimJob(id, 'rule', '2026-10-07')).toBe(false);
      await again.finishJob(id, 'rule', '2026-10-07', 'failed');
      expect((await again.jobErrors(id))[0].status).toBe('failed');
    });
    test('offline portable backup restores to SQLite, retains login and rejects tampering', async () => {
      const root = await directory(), app = await start(root), owner = client(app);
      await owner.rpc('kernel.createSession', 'Portable backup');
      await owner.rpc('llm.setCredential', 'deepseek', 'dummy-portable-key');
      await owner.auth('register', { username: 'portable', password });
      const backup = await directory();
      await expect(backupData(root, backup, undefined, options)).rejects.toThrow('in use');
      await app.close();
      const database = await open(root);
      await setAdministrator(database, 'portable', true);
      await database.write(join(root, 'server', 'settings.json'), { modelAllowedHosts: ['apihub.agnes-ai.com'], revision: 1, updatedAt: Date.now(), updatedBy: 'portable' });
      await database.close();
      await backupData(root, backup, undefined, options);
      const restored = await directory();
      await restoreData(backup, restored, { kind: 'sqlite' });
      const local = await createWebApplication({ dataDir: restored }); apps.push(local);
      const user = client(local);
      const restoredLogin = await user.auth('login', { username: 'portable', password });
      expect(restoredLogin.ok).toBe(true); expect(restoredLogin.data.user.role).toBe('admin');
      expect((await user.admin('getSettings')).data.modelAllowedHosts).toEqual(['apihub.agnes-ai.com']);
      expect((await user.rpc('kernel.hydrate')).data.sessions[0].title).toBe('Portable backup');
      expect((await user.rpc('llm.getState')).data.model.provider).toBe('deepseek');
      await writeFile(join(backup, 'database-snapshot.json'), '{}');
      await expect(restoreData(backup, await directory())).rejects.toThrow('checksum');
    });
    test('portable snapshots from before administrator support restore as ordinary accounts', async () => {
      const root = await directory(), app = await start(root);
      expect((await client(app).auth('register', { username: 'legacy', password })).ok).toBe(true);
      await app.close();
      const database = await open(root);
      const legacy = await database.snapshot();
      delete (legacy.tables as Partial<typeof legacy.tables>).administrators;
      await database.close();
      const restoredRoot = await directory(), restored = await WorkspaceDatabase.open(restoredRoot);
      connections.push(restored);
      await restored.restore(legacy);
      expect((await restored.snapshot()).tables.administrators).toEqual([]);
      await restored.close();
      const local = await createWebApplication({ dataDir: restoredRoot }); apps.push(local);
      expect((await client(local).auth('login', { username: 'legacy', password })).data.user.role).toBe('user');
    });
    if (kind === 'postgresql') {
      test('SQLite backup migrates to PostgreSQL and rejects a second server on another data directory', async () => {
        const localRoot = await directory(), local = await createWebApplication({ dataDir: localRoot }); apps.push(local);
        const owner = client(local);
        await owner.rpc('workspace.update', { watchlist: ['TSLA.US'] });
        await owner.rpc('llm.setCredential', 'deepseek', 'dummy-migrated-key');
        await owner.auth('register', { username: 'migrated', password });
        await local.close();
        const backup = await directory(), remoteRoot = await directory();
        await backupData(localRoot, backup);
        await restoreData(backup, remoteRoot, options);
        const remote = await start(remoteRoot), user = client(remote);
        expect((await user.auth('login', { username: 'migrated', password })).ok).toBe(true);
        expect((await user.rpc('workspace.get')).data.watchlist).toEqual(['TSLA.US']);
        expect((await user.rpc('llm.getState')).data.model.provider).toBe('deepseek');
        await expect(createWebApplication({ dataDir: await directory(), database: options })).rejects.toThrow('in use');
        await remote.close();
        await expect(restoreData(backup, await directory(), options)).rejects.toThrow('must be empty');
      });
    }
    test('previous SQLite migration imports authoritative skill/checkpoint files without reverting documents', async () => {
      const root = await directory(), database = await open(root);
      const visitor = join(root, 'visitors', 'd'.repeat(32));
      const checkpoint = join(visitor, 'store', 'research', 'checkpoints', 'run.json');
      const skill = join(visitor, 'skills-state.json'), workspace = join(visitor, 'workspace.json');
      await mkdir(join(visitor, 'store', 'research', 'checkpoints'), { recursive: true });
      await database.write(join(root, '__migration_v1__'), { at: 1 });
      await database.write(workspace, { watchlist: ['MSFT.US'] });
      await database.write(skill, { enabled: true });
      await writeFile(workspace, JSON.stringify({ watchlist: ['STALE.US'] }));
      await writeFile(skill, JSON.stringify({ enabled: false }));
      await writeFile(checkpoint, JSON.stringify({ id: 'run' }));
      await database.migrateFiles();
      expect(await database.read<unknown>(workspace, null)).toEqual({ watchlist: ['MSFT.US'] });
      expect(await database.read<unknown>(skill, null)).toEqual({ enabled: false });
      expect(await database.listFiles(join(visitor, 'store', 'research', 'checkpoints'))).toEqual(['run.json']);
      expect(await database.read<unknown>(checkpoint, null)).toEqual({ id: 'run' });
      await writeFile(skill, JSON.stringify({ enabled: true }));
      await database.migrateFiles();
      expect(await database.read<unknown>(skill, null)).toEqual({ enabled: false });
    });
    test('legacy JSON migrates once; changing database type cannot silently hide existing data', async () => {
      const root = await directory();
      await mkdir(join(root, 'visitors', 'c'.repeat(32)), { recursive: true });
      const path = join(root, 'visitors', 'c'.repeat(32), 'workspace.json');
      await writeFile(path, JSON.stringify({ watchlist: ['MSFT.US'] }));
      const database = await open(root); await database.migrateFiles();
      await writeFile(path, JSON.stringify({ watchlist: ['AAPL.US'] }));
      await database.migrateFiles(); expect(await database.read<unknown>(path, null)).toEqual({ watchlist: ['MSFT.US'] });
      await database.close();
      const different: DatabaseOptions = kind === 'sqlite' ? { kind: 'postgresql', url: 'postgres://test@localhost/felix' } : { kind: 'sqlite' };
      await expect(WorkspaceDatabase.open(root, different)).rejects.toThrow('Storage type changed');
    });
  });
}
