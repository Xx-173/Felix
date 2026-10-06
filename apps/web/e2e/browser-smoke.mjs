import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// The repository's existing browser test dependency; no browser download needed.
const { chromium } = createRequire(resolve(root, 'apps/electron/package.json'))('playwright-core');
const origin = new URL(process.env.FELIX_TEST_URL ?? 'http://127.0.0.1:8787').origin;
const artifacts = resolve(root, 'artifacts/web');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.FELIX_BROWSER_PATH ?? (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome'),
});
const errors = [], steps = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sidebar').waitFor();
  assert.match(await page.locator('body').innerText(), /示例行情/);
  assert.equal(await page.evaluate(() => Boolean(window.electronAPI)), false);
  steps.push('普通浏览器启动，明确标注示例行情与规则分析');
  await page.getByRole('button', { name: /^新建会话（/ }).click();
  await page.getByTestId('agent-input').fill('查询 AAPL.US 的行情');
  await page.getByTestId('agent-input').press('Enter');
  await page.waitForFunction(async () => {
    const rpc = async (method, args = []) => (await (await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })).json()).data;
    const sessions = (await rpc('kernel.hydrate')).sessions;
    return sessions.length && (await rpc('kernel.getMessages', [sessions[0].id])).length === 2;
  });
  await page.getByTestId('agent-input').fill('再次查询 MSFT.US');
  await page.getByTestId('agent-input').press('Enter');
  await page.waitForFunction(async () => {
    const rpc = async (method, args = []) => (await (await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })).json()).data;
    const sessions = (await rpc('kernel.hydrate')).sessions;
    return (await rpc('kernel.getMessages', [sessions[0].id])).length === 4;
  });
  steps.push('从界面连续发送两轮问题，SSE 回答并保存四条消息');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('agent-panel').waitFor();
  await page.getByTestId('agent-panel').getByText('再次查询 MSFT.US', { exact: true }).waitFor();
  steps.push('刷新后恢复会话与消息');
  await page.getByTestId('sidebar').getByRole('button', { name: /^工作台（/ }).click();
  if (!await page.getByTestId('watchlist-row-AAPL.US').count()) {
    await page.getByPlaceholder('AAPL.US', { exact: true }).fill('AAPL.US');
    await page.getByRole('button', { name: /^添加标的（/ }).click();
  }
  await page.getByTestId('watchlist-row-AAPL.US').click();
  await page.getByTestId('sidebar').getByRole('button', { name: /^研究（/ }).click();
  await page.getByTestId('research-panel').waitFor();
  await page.getByTestId('research-panel').getByRole('button', { name: '深度研究（Deep Research）', exact: true }).click();
  await page.getByTestId('research-report').waitFor({ timeout: 30000 });
  steps.push('从界面启动研究，生成并显示研究报告');
  await page.getByTestId('export-menu-trigger').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download-markdown').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /research\.md$/);
  steps.push('研究报告可下载为 Markdown');
  await page.getByRole('button', { name: /^保存.*投资/ }).click();
  await page.getByTestId('sidebar').getByRole('button', { name: /^投资逻辑（/ }).click();
  await page.getByTestId('thesis-card').waitFor();
  steps.push('研究报告可保存为投资论点，并在完整投资逻辑页面查看');
  for (const label of ['今日', '机会发现', '工作台', '投资组合', '对比', '提醒', '研究', '投资逻辑', '技能', '评测', '事件', '个人与安全', '设置']) {
    const button = page.getByTestId('sidebar').getByRole('button', { name: new RegExp('^' + label + '（') });
    assert.equal(await button.count(), 1, label + ' navigation preserved');
    await button.click(); await page.waitForTimeout(180);
    assert.equal(await page.locator('body').getByText('Something went wrong', { exact: true }).count(), 0);
  }
  steps.push('桌面全部 13 个导航入口保留，逐页打开无脚本错误');
  await page.getByRole('tab', { name: /^大语言模型（/ }).click();
  const credential = page.locator('input[type="password"]').first();
  await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 5);
  await credential.pressSequentially('dummy-browser-test-key', { delay: 30 });
  await credential.locator('..').getByRole('button', { name: /^保存（/ }).click();
  await page.waitForFunction(async () => {
    const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"method":"llm.listCredentials"}' });
    return (await response.json()).data.some((item) => item.configured);
  });
  await page.getByRole('button', { name: /^移除（/ }).first().click();
  await page.waitForFunction(async () => {
    const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"method":"llm.listCredentials"}' });
    return (await response.json()).data.every((item) => !item.configured);
  });
  steps.push('通过原有模型设置页保存及移除访客自己的密钥');
  await page.getByTestId('sidebar').getByRole('button', { name: /^今日（/ }).click();
  await page.screenshot({ path: resolve(artifacts, 'web-desktop.png') });
  const second = await browser.newContext();
  const other = await second.newPage(); await other.goto(origin, { waitUntil: 'domcontentloaded' });
  await other.getByTestId('sidebar').waitFor();
  const sessions = await other.evaluate(async () => (await (await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"method":"kernel.hydrate"}' })).json()).data.sessions);
  assert.equal(sessions.length, 0); steps.push('新浏览器访客没有前一访客的会话');
  await second.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '研究助手（Copilot）', exact: true }).click();
  await page.getByTestId('agent-input').waitFor({ state: 'visible' });
  await page.screenshot({ path: resolve(artifacts, 'web-mobile.png') });
  steps.push('390px 手机宽度可切换并使用研究助手');
  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'browser-result.json'), JSON.stringify({ passed: true, steps, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: true, steps, pageErrors: errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(artifacts, 'web-failure.png') }).catch(() => {});
  console.error(JSON.stringify({ passed: false, steps, pageErrors: errors, error: error.message,
    visibleText: (await page?.locator('body').innerText().catch(() => '')).slice(0, 2200) }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
