import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(join(root, 'apps/electron/package.json'))('playwright-core');
const directory = await mkdtemp(join(tmpdir(), 'felix-admin-browser-'));
if (process.env.FELIX_DATABASE_TYPE === 'postgresql' && !new URL(process.env.FELIX_DATABASE_URL).pathname.startsWith('/felix_test')) throw new Error('Admin browser tests require a dedicated felix_test PostgreSQL database.');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const username = `admin-${randomBytes(6).toString('hex')}`;
const password = 'admin-browser-dummy-password-2026';
const env = { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), FELIX_DATA_DIR: directory, FELIX_STATIC_DIR: join(root, 'apps/web/dist'), FELIX_DEMO_DATA: '1', FELIX_COOKIE_SECRET: '', FELIX_PUBLIC_ORIGIN: '', FELIX_INVITE_CODE: '', FELIX_MODEL_ALLOWED_HOSTS: '', FELIX_ADMIN_TEST_USERNAME: username };
const seed = `
import { createWebApplication } from './apps/server/src/app.ts';
import { WorkspaceDatabase, databaseOptions } from './apps/server/src/database.ts';
import { setAdministrator } from './apps/server/src/accounts.ts';
const database = databaseOptions(process.env);
const app = await createWebApplication({ dataDir: process.env.FELIX_DATA_DIR, database });
try {
 const result = await (await app.fetch(new Request('http://localhost/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'register',input:{username:process.env.FELIX_ADMIN_TEST_USERNAME,password:'admin-browser-dummy-password-2026'}}) }))).json();
 if(!result.ok) throw new Error('Cannot seed administrator test account');
} finally { await app.close(); }
const db = await WorkspaceDatabase.open(process.env.FELIX_DATA_DIR, database, false);
try {
 await setAdministrator(db, process.env.FELIX_ADMIN_TEST_USERNAME, true);
 // The preceding PostgreSQL browser suite uses the same test database and
 // loopback address. Keep its persisted rate counters out of this fixture.
 await db.query('DELETE FROM auth_attempts WHERE key=$1', ['127.0.0.1:register']);
} finally { await db.close(); }
`;
let server, browser, diagnostics = '';
try {
  const fixture = spawnSync('bun', ['--no-env-file', '-e', seed], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(fixture.status, 0, fixture.stderr);
  server = spawn('bun', ['--no-env-file', 'apps/server/src/index.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-5000); });
  server.on('error', (error) => { diagnostics += error.message; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${diagnostics}`);
    try { if ((await fetch(origin + '/healthz')).ok) { ready = true; break; } } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(ready, 'Administrator test server failed to start');
  browser = await chromium.launch({ headless: true, executablePath: process.env.FELIX_BROWSER_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome') });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin); await page.getByTestId('sidebar').waitFor();
  assert.equal(await page.getByRole('button', { name: '管理设置（Administration）', exact: true }).count(), 0);
  await page.getByTestId('account-bar').getByRole('button', { name: '登录（Sign in）', exact: true }).click();
  const login = page.getByRole('dialog', { name: '登录（Sign in）', exact: true });
  await login.getByLabel('用户名（Username）', { exact: true }).fill(username);
  await login.getByLabel('密码（Password）', { exact: true }).fill(password);
  await Promise.all([page.waitForEvent('load'), login.getByRole('button', { name: '登录（Sign in）', exact: true }).click()]);
  await page.getByRole('button', { name: '管理设置（Administration）', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '管理设置（Administration）', exact: true });
  await dialog.getByLabel('允许的模型域名（Allowed model domains）', { exact: true }).fill('https://example.com/v1');
  await dialog.getByRole('button', { name: '保存并生效（Save and apply）', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByLabel('允许的模型域名（Allowed model domains）', { exact: true }).fill('apihub.agnes-ai.com');
  await dialog.getByRole('button', { name: '保存并生效（Save and apply）', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  const configured = await page.evaluate(async () => {
    const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'llm.setCustomProvider', args: [{ name: 'agnes', displayName: 'Agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'dummy-domain-browser-key', models: [{ id: 'agnes-3.0-flash', name: 'Agnes' }] }] }) });
    return response.json();
  });
  assert.equal(configured.ok, true);
  await dialog.getByRole('button', { name: '关闭（Close）', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '管理设置（Administration）', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '管理设置（Administration）', exact: true });
  await dialog.getByLabel('允许的模型域名（Allowed model domains）', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'apihub.agnes-ai.com');
  await mkdir(join(root, 'artifacts/web'), { recursive: true });
  await page.screenshot({ path: join(root, 'artifacts/web/admin-settings.png') });
  const ordinary = await browser.newContext(), ordinaryPage = await ordinary.newPage();
  await ordinaryPage.goto(origin);
  const registered = await ordinaryPage.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register', input: { username: 'user-' + username, password, role: 'admin' } }) });
    return response.json();
  }, { username, password });
  assert.equal(registered.ok, true, JSON.stringify(registered.error));
  assert.equal(registered.data.user.role, 'user');
  await ordinaryPage.reload(); await ordinaryPage.getByTestId('account-bar').getByText(new RegExp('user-' + username)).waitFor();
  assert.equal(await ordinaryPage.getByRole('button', { name: '管理设置（Administration）', exact: true }).count(), 0);
  const denied = await ordinaryPage.evaluate(async () => (await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"getSettings"}' })).status);
  assert.equal(denied, 403); assert.deepEqual(errors, []);
  console.log('Administrator browser settings: role isolation, domain validation, immediate custom-provider approval and persisted UI passed.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
  if (!directory.startsWith(resolve(tmpdir()) + sep + 'felix-admin-browser-')) throw new Error('Invalid cleanup boundary');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
