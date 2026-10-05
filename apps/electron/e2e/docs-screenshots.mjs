// Recreate documentation screenshots from the real desktop app using demo data.
// Run from the repo root: bun run build && node apps/electron/e2e/docs-screenshots.mjs
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedLocale } from './seed-locale.mjs';
import { reserveCdpPort, spawnElectron, waitForCdp } from './electron-harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(here, '../../..');
const artifacts = join(here, 'artifacts');
const output = join(repoRoot, 'docs/screenshots');
mkdirSync(artifacts, { recursive: true });
mkdirSync(output, { recursive: true });
const userDataDir = mkdtempSync(join(artifacts, 'docs-profile-'));
seedLocale(userDataDir, 'en-US');
process.env.FINAGENT_DEMO_DATA = '1';
process.env.FINAGENT_DOCS_SCREENSHOTS = '1';
const port = await reserveCdpPort();
const url = `http://127.0.0.1:${port}`;
const logPath = join(userDataDir, 'electron.log');
const { proc, log } = spawnElectron({ appRoot, repoRoot, port, userDataDir, logPath });
let browser;

try {
  await waitForCdp({ url, timeoutMs: 45_000, proc, logPath });
  browser = await chromium.connectOverCDP(url, { timeout: 15_000 });
  const context = browser.contexts()[0];
  const deadline = Date.now() + 15_000;
  while (context.pages().length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const page = context.pages()[0];
  if (!page) throw new Error('No desktop renderer');
  page.on('pageerror', (error) => console.error('Renderer error:', error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-testid="finance-workspace"]').waitFor();
  const onboarding = page.locator('[data-testid="onboarding-overlay"]');
  // The wizard appears after kernel hydration; the shell can render first.
  await onboarding.waitFor({ state: 'visible', timeout: 15_000 });
  if (await onboarding.isVisible()) {
    await page.locator('[data-testid="disclaimer-accept"]').click();
    await page.locator('[data-testid="onboarding-continue"]').click();
    await page.locator('[data-testid="onboarding-skip"]').click();
    await onboarding.waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  await page.locator('[data-testid="agent-input"]').waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });

  async function capture(name, directory = output) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(750);
    const text = await page.locator('body').innerText();
    if (/Command failed|is not recognized as an internal|\uFFFD/.test(await page.locator('.felix-banner').innerText().catch(() => ''))) throw new Error(`Raw CLI failure visible in ${name}`);
    if (/\bFolio\b/.test(text)) throw new Error(`Old brand visible in ${name}`);
    if (!text.includes('Felix Research')) throw new Error(`Missing Felix branding in ${name}`);
    const cdp = await context.newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
      });
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
    } finally {
      await cdp.detach();
    }
    console.log(`CAPTURE ${name}: Felix branding verified`);
  }

  async function navigate(label, ready) {
    await page.locator('[data-testid="sidebar"]').getByRole('button', { name: label, exact: true }).click();
    if (ready) await page.locator(`[data-testid="${ready}"]`).waitFor();
  }

  await navigate('Today', 'today-view');
  if (!process.argv.includes('--agent-only')) {
    await capture('today');
    await navigate('Workspace');
    await page.locator('[data-testid="watchlist-row-NVDA.US"]').first().click();
    await page.locator('[data-testid="security-header-symbol"]').filter({ hasText: 'NVDA.US' }).waitFor();
    await capture('workspace');
    for (const [name, label, ready] of [
      ['events', 'Events', 'events-view'],
      ['portfolio', 'Portfolio'],
      ['profile', 'Profile & Security', 'profile-view'],
      ['settings', 'Settings'],
      ['evaluation', 'Evaluation', 'evaluation-center'],
      ['skills', 'Skills'],
      ['discover', 'Discover', 'discover-view'],
    ]) {
      await navigate(label, ready);
      if (name === 'profile') {
        await page.getByText('Sample data only', { exact: true }).waitFor();
        await page.getByText('Local rules only', { exact: true }).waitFor();
        console.log('VERIFY demo health is separate from connected services');
      }
      await capture(name);
    }
  }

  // The structured-answer examples also include the app's title and sidebar.
  await navigate('Today', 'today-view');
  for (const [name, prompt, type] of [
    ['agent-typed-blocks-quote', 'What is the quote for AAPL.US?', 'metric_grid'],
    ['agent-typed-blocks-portfolio', 'Show my portfolio', 'data_table'],
    ['agent-typed-blocks-risk', 'What is my portfolio risk?', 'comparison_table'],
  ]) {
    await page.getByRole('button', { name: 'New Session', exact: true }).click();
    await page.waitForTimeout(500);
    const input = page.locator('[data-testid="agent-input"]').first();
    await input.fill(prompt);
    await input.press('Enter');
    // Wait for main-process persistence, rather than guessing how long a
    // provider fallback and multi-tool risk analysis will take.
    const deadline = Date.now() + 60_000;
    let persisted = false;
    while (!persisted && Date.now() < deadline) {
      persisted = await page.evaluate(async (prompt) => {
        const snapshot = await window.electronAPI.kernel.hydrate();
        if (!snapshot.ok) return false;
        for (const session of snapshot.data.sessions) {
          const runs = await window.electronAPI.kernel.listRuns(session.id);
          if (!runs.ok) continue;
          const run = runs.data.find((entry) => entry.input === prompt);
          if (run?.status === 'failed' || run?.status === 'cancelled') {
            throw new Error(`Documentation example ${run.status}: ${prompt}`);
          }
          if (run?.status !== 'completed') continue;
          // The terminal run record is saved before its assistant message.
          const messages = await window.electronAPI.kernel.getMessages(session.id);
          return messages.ok && messages.data.some((message) =>
            message.role === 'assistant' && message.content.includes('felix-block'));
        }
        return false;
      }, prompt);
      if (!persisted) await page.waitForTimeout(300);
    }
    if (!persisted) throw new Error(`Documentation answer did not persist: ${prompt}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="agent-input"]').waitFor();
    const block = page.locator(`[data-testid="agent-panel"] [data-block-type="${type}"]`).first();
    try {
      await block.waitFor({ timeout: 15_000 });
    } catch (error) {
      console.error('Agent panel:', await page.locator('[data-testid="agent-panel"]').innerText());
      throw error;
    }
    await page.locator('[data-testid="today-view"] .felix-stitch-card').filter({ hasText: 'TOTAL VALUE' }).getByText('Sample data', { exact: true }).first().waitFor();
    await block.scrollIntoViewIfNeeded();
    await capture(name);
    if (name === 'agent-typed-blocks-quote') {
      const evidenceOutput = join(repoRoot, 'docs/evidence/issue30');
      await capture('S2-block-evidence-chips', evidenceOutput);
      await page.locator('[data-testid="open-source-inspector"]').first().click();
      await page.locator('[data-testid="source-inspector"]').waitFor();
      await capture('S4-source-inspector', evidenceOutput);
      await page.keyboard.press('Escape');
      await page.locator('[data-testid="source-inspector"]').waitFor({ state: 'detached' });
      const chip = page.locator('[data-evidence-id]').first();
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await page.locator('[data-testid="source-details"]').first().waitFor();
      await capture('S5-inspector-from-chip', evidenceOutput);
      await page.keyboard.press('Escape');
      await page.locator('[data-testid="source-inspector"]').waitFor({ state: 'detached' });
    }
  }
  console.log(process.argv.includes('--agent-only')
    ? 'Updated 3 answer screenshots and 3 citation screenshots using local demo data.'
    : 'Updated all 12 documentation screenshots and 3 citation screenshots using local demo data.');
} finally {
  await browser?.close().catch(() => {});
  proc.kill();
  log.end();
}
