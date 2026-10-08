// Run after build:electron. Uses an isolated profile and the actual Electron runtime.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(appRoot, 'package.json'));
const electron = require('electron');
const { chromium } = require('playwright-core');
const profile = await mkdtemp(join(tmpdir(), 'felix-desktop-storage-'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
await writeFile(join(profile, 'workspace.json'), JSON.stringify({ watchlist: ['TSLA.US'] }));
let child, browser, page, diagnostics = '';
async function launch() {
  const env = { ...process.env, FINAGENT_AGENT_PROVIDER: 'local', FINAGENT_E2E: '1', FINAGENT_E2E_HIDDEN: '1', FINAGENT_DOCS_SCREENSHOTS: '1', FINAGENT_DEMO_DATA: '1', FINAGENT_FORCE_PROD_LOAD: '1', FINAGENT_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [appRoot, `--remote-debugging-port=${port}`, '--no-sandbox'], { cwd: appRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env });
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000); });
  child.on('error', (error) => { diagnostics += error.message; });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited: ${diagnostics}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
  page = browser.contexts()[0].pages()[0];
  await page.getByTestId('sidebar').waitFor({ timeout: 30000 });
}
async function stop() {
  const exited = child.exitCode !== null ? Promise.resolve() : once(child, 'exit');
  // Closing the real window exercises before-quit disposal and SQLite shutdown.
  await page.evaluate(() => window.electronAPI.window.close()).catch(() => undefined);
  const timeout = setTimeout(() => child.kill(), 15000);
  try { await exited; } finally { clearTimeout(timeout); }
  await browser.close().catch(() => undefined);
  browser = undefined;
}
try {
  await launch();
  const artifacts = resolve(appRoot, '../../artifacts/web');
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const skip = page.getByTestId('onboarding-skip');
  await skip.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  if (await skip.isVisible()) await skip.click();
  assert.equal(await page.getByTestId('account-bar').count(), 0, 'desktop keeps its local account behavior');
  await page.getByTestId('sidebar').getByRole('button', { name: /^市场看板（/ }).click();
  await page.getByTestId('market-dashboard').waitFor();
  await page.getByRole('tab', { name: '港股（HK）', exact: true }).click();
  await page.locator('[data-market=HK]').waitFor();
  await page.getByRole('tab', { name: '美股（US）', exact: true }).click();
  await page.locator('[data-market=US]').waitFor();
  await page.screenshot({ path: join(artifacts, 'desktop-market-dashboard.png') });
  await page.getByTestId('assistant-close').click();
  await page.locator('.felix-index-card').first().getByRole('button').click();
  await page.locator('[data-testid=index-workspace][data-symbol="SPX.US"]').waitFor();
  await page.getByTestId('chart-canvas').waitFor();
  await page.getByTestId('index-item-NDX.US').click();
  await page.locator('[data-testid=index-workspace][data-symbol="NDX.US"]').waitFor();
  await page.getByTestId('chart-canvas').waitFor();
  assert.deepEqual((await page.evaluate(() => window.electronAPI.workspace.get())).data.watchlist, ['TSLA.US']);
  await page.screenshot({ path: join(artifacts, 'desktop-index-workspace.png') });
  await page.getByRole('button', { name: '返回市场看板（Back to market dashboard）', exact: true }).click();
  await page.getByTestId('new-session-fab').click();
  await page.getByTestId('agent-input').waitFor();
  assert.equal(await page.locator('.felix-assistant-questions button').count(), 17);
  await page.getByTestId('assistant-group-stocks').getByRole('button', { name: /^我的自选表现如何/ }).click();
  assert.match(await page.getByTestId('agent-input').inputValue(), /TSLA.US/);
  await page.getByTestId('assistant-expand').click();
  await page.screenshot({ path: join(artifacts, 'desktop-assistant-welcome.png') });
  await page.getByTestId('assistant-expand').click();
  await page.getByTestId('assistant-new-session').click();
  await page.getByTestId('sidebar').getByRole('button', { name: /^自选（/ }).click();
  await page.getByTestId('workspace-home').waitFor();
  await page.getByRole('button', { name: '管理分组（Manage groups）', exact: true }).click();
  const groupDialog = page.getByRole('dialog', { name: '管理分组（Manage groups）', exact: true });
  await groupDialog.getByRole('textbox', { name: '分组名称（Group name）', exact: true }).fill('桌面研究');
  await groupDialog.getByRole('button', { name: '新建分组（Create group）', exact: true }).click();
  await groupDialog.getByRole('button', { name: '完成（Done）', exact: true }).click();
  await page.getByRole('button', { name: '设置 TSLA.US 的分组（Set groups for TSLA.US）', exact: true }).click();
  const membership = page.getByRole('dialog', { name: /所属分组/ });
  await membership.getByRole('checkbox', { name: '桌面研究', exact: true }).check();
  await membership.getByRole('button', { name: '完成（Done）', exact: true }).click();
  await page.waitForFunction(async () => (await window.electronAPI.workspace.get()).data.groups?.[0].symbols.includes('TSLA.US'));
  assert.equal(await page.locator('.felix-sidebar-context').count(), 0);
  assert.ok((await page.getByTestId('watchlist-row-TSLA.US').boundingBox()).height >= 42);
  await page.screenshot({ path: join(artifacts, 'desktop-workspace-home.png') });
  await page.getByRole('tab', { name: '美股（US）', exact: true }).click();
  await page.getByTestId('watchlist-row-TSLA.US').waitFor();
  await page.getByRole('tab', { name: 'A 股（CN）', exact: true }).click();
  assert.equal(await page.getByTestId('watchlist-row-TSLA.US').isVisible(), false);
  await page.getByTestId('sidebar').getByRole('button', { name: /^机会发现（/ }).click();
  await page.getByRole('tab', { name: 'A 股（CN）', exact: true }).click();
  await page.getByTestId('limit-up-ladder').getByText('示例甲（Sample A）', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.electronAPI.market.getLimitUpLadder('2026-10-08'))).data.source, 'demo');
  await page.screenshot({ path: join(artifacts, 'desktop-discover-ladder.png') });
  await page.getByTestId('sidebar').getByRole('button', { name: /^研究（/ }).click();
  await page.getByRole('tab', { name: '美股（US）', exact: true }).click();
  await page.getByTestId('research-symbol-input').fill('TSLA.US');
  await page.getByTestId('research-symbol-submit').click();
  await page.locator('[data-testid=research-market-workspace][data-symbol="TSLA.US"]').waitFor();
  await page.getByTestId('research-key-levels').waitFor();
  await page.getByTestId('chart-canvas').waitFor();
  await page.screenshot({ path: join(artifacts, 'desktop-research-market.png') });
  await page.getByTestId('sidebar').getByRole('button', { name: /^投资组合（/ }).click();
  await page.getByTestId('portfolio-view').getByText(/^这里仅显示你导入/).waitFor();
  await page.getByTestId('sidebar').getByRole('button', { name: /^自选（/ }).click();
  await page.getByRole('tab', { name: '美股（US）', exact: true }).click();
  await page.getByTestId('watchlist-row-TSLA.US').click();
  await page.getByRole('tab', { name: 'K 线（Chart）', exact: true }).click();
  await page.getByTestId('chart-canvas').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(artifacts, 'desktop-workbench.png') });
  await page.getByRole('button', { name: '切换深色主题（Dark theme）', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(artifacts, 'desktop-workbench-dark.png') });
  await page.getByRole('button', { name: '切换浅色主题（Light theme）', exact: true }).click();
  const migrated = await page.evaluate(() => window.electronAPI.workspace.get());
  assert.deepEqual(migrated.data.watchlist, ['TSLA.US']);
  assert.equal((await page.evaluate(() => window.electronAPI.workspace.update({ watchlist: ['MSFT.US'] }))).ok, true);
  assert.deepEqual((await page.evaluate(() => window.electronAPI.workspace.get())).data.groups[0].symbols, [], 'legacy updates retain group and prune removed membership');
  const session = await page.evaluate(() => window.electronAPI.kernel.createSession('SQLite restart'));
  assert.equal(session.ok, true);
  const skills = await page.evaluate(() => window.electronAPI.skills.list());
  const skillId = skills.data[0].id;
  assert.equal((await page.evaluate((skillId) => window.electronAPI.skills.setEnabled({ skillId, enabled: false }), skillId)).ok, true);
  await stop();
  const sql = new DatabaseSync(join(profile, 'felix.sqlite'), { readOnly: true });
  try { assert.deepEqual(JSON.parse(sql.prepare("SELECT value FROM documents WHERE key='workspace.json'").get().value).watchlist, ['MSFT.US']); }
  finally { sql.close(); }
  // Legacy JSON must never override the authoritative database after migration.
  await writeFile(join(profile, 'workspace.json'), JSON.stringify({ watchlist: ['STALE.US'] }));
  await launch();
  assert.deepEqual((await page.evaluate(() => window.electronAPI.workspace.get())).data.watchlist, ['MSFT.US']);
  assert.equal((await page.evaluate(() => window.electronAPI.workspace.get())).data.groups[0].name, '桌面研究');
  const hydrated = await page.evaluate(() => window.electronAPI.kernel.hydrate());
  assert(hydrated.data.sessions.some((item) => item.id === session.data.id));
  const restoredSkills = await page.evaluate(() => window.electronAPI.skills.list());
  assert.equal(restoredSkills.data.find((item) => item.id === skillId).enabled, false);
  await stop();
  console.log('Desktop SQLite: legacy migration, document/skill/session persistence and real-process restart passed.');
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (!profile.startsWith(resolve(tmpdir()) + sep + 'felix-desktop-storage-')) throw new Error('Invalid cleanup boundary');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
