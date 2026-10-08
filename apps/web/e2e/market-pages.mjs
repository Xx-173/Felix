import { uiText } from './ui-text.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Run new market pages in their own guest workspace, independent of account lifecycle tests. */
export async function verifyMarketPages(browser, origin, artifacts) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sidebar').waitFor();
    await page.getByTestId('assistant-close').click();
  // Market scoping uses real persisted watchlists in an isolated guest browser profile.
  await page.getByTestId('sidebar').getByRole('button', { name: /^自选(?:（|$)/ }).click();
  await page.getByRole('button', { name: uiText('批量导入（Batch import）'), exact: true }).click();
  const marketImport = page.getByRole('dialog', { name: uiText('批量导入（Batch import）'), exact: true });
  await marketImport.getByRole('textbox', { name: uiText('待导入代码（Codes to import）'), exact: true }).fill('600519.SH, 0700.HK');
  await marketImport.getByRole('button', { name: /^确认导入/ }).click();
  for (const [market, symbol, label] of [['CN', '600519.SH', 'A 股（CN）'], ['HK', '0700.HK', '港股（HK）'], ['US', 'AAPL.US', '美股（US）']]) {
    await page.getByRole('tab', { name: uiText(label), exact: true }).click();
    await page.getByTestId('watchlist-row-' + symbol).waitFor();
    const listed = await page.locator('.felix-watchlist-open:visible').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    assert.ok(listed.every((code) => market === 'CN' ? /\.(SH|SZ|HAS)$/.test(code) : code.endsWith('.' + market)));
    await page.screenshot({ path: resolve(artifacts, 'watchlist-market-' + market + '.png') });
  }
  await page.getByTestId('sidebar').getByRole('button', { name: /^机会发现(?:（|$)/ }).click();
  await page.getByRole('tab', { name: uiText('A 股（CN）'), exact: true }).click();
  await page.getByTestId('limit-up-ladder').getByText(uiText('示例甲（Sample A）'), { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('[data-testid=limit-up-ladder]').compareDocumentPosition(document.querySelector('[data-testid=discover-family-market-movers]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.screenshot({ path: resolve(artifacts, 'discover-ladder-CN.png') });
  await page.getByRole('button', { name: uiText('切换深色主题（Dark theme）'), exact: true }).click();
  await page.waitForTimeout(200); await page.screenshot({ path: resolve(artifacts, 'discover-ladder-dark.png') });
  await page.getByRole('button', { name: uiText('切换浅色主题（Light theme）'), exact: true }).click();
  await page.getByRole('tab', { name: uiText('港股（HK）'), exact: true }).click();
  assert.match(await page.getByTestId('limit-up-ladder').innerText(), /不采用 A 股/);
  await page.getByRole('tab', { name: uiText('美股（US）'), exact: true }).click();
  assert.match(await page.getByTestId('limit-up-ladder').innerText(), /不采用 A 股/);
  await page.getByTestId('sidebar').getByRole('button', { name: /^研究(?:（|$)/ }).click();
  let researchCalls = 0;
  const trackResearch = (request) => { if (request.postData()?.includes('research.start')) researchCalls++; };
  page.on('request', trackResearch);
  for (const [market, symbol, label, currency] of [['CN', '600519.SH', 'A 股（CN）', 'CNY'], ['HK', '0700.HK', '港股（HK）', 'HKD'], ['US', 'AAPL.US', '美股（US）', 'USD']]) {
    await page.getByRole('tab', { name: uiText(label), exact: true }).click();
    await page.getByTestId('research-symbol-input').fill(symbol);
    await page.getByTestId('research-symbol-submit').click();
    await page.locator('[data-testid=research-market-workspace][data-symbol="' + symbol + '"]').waitFor();
    await page.getByTestId('research-key-levels').waitFor();
    await page.getByTestId('chart-canvas').waitFor();
    assert.match(await page.locator('.felix-research-asset-overline').innerText(), new RegExp(currency));
    await page.getByTestId('research-history').waitFor();
    await page.screenshot({ path: resolve(artifacts, 'research-market-' + market + '.png') });
  }
  assert.equal(researchCalls, 0, 'browsing stocks never calls AI'); page.off('request', trackResearch);
  await page.getByTestId('sidebar').getByRole('button', { name: /^投资组合(?:（|$)/ }).click();
  await page.getByTestId('portfolio-view').getByText(/^连接证券账户或导入持仓后/).waitFor();
  assert.equal(await page.locator('.felix-asset-pie, .felix-portfolio-risk-panel').count(), 0);
  assert.doesNotMatch(await page.getByTestId('portfolio-view').innerText(), /109,210/);
  await page.screenshot({ path: resolve(artifacts, 'portfolio-own-assets.png') });
  await page.getByTestId('portfolio-view').getByRole('button', { name: /^导入/ }).click();
  const portfolioImport = page.getByRole('dialog', { name: /^导入投资组合/ });
  await portfolioImport.getByRole('button', { name: /^粘贴持仓/ }).click();
  await portfolioImport.locator('textarea').fill('AAPL.US 12 180.5');
  await portfolioImport.getByRole('button', { name: /^解析/ }).click();
  await portfolioImport.getByRole('button', { name: /^确认导入/ }).waitFor();
  await portfolioImport.getByRole('textbox').fill('Market page fixture');
  await portfolioImport.getByRole('button', { name: /^确认导入/ }).click();
  await portfolioImport.waitFor({ state: 'hidden' });
  await page.getByTestId('portfolio-view').getByText('AAPL.US', { exact: true }).first().waitFor();
  assert.match(await page.getByTestId('portfolio-view').innerText(), /Market page fixture/);
  assert.doesNotMatch(await page.getByTestId('portfolio-view').innerText(), /109,210|NVDA.US|MSFT.US|TSLA.US/);
  await page.reload();
  await page.getByTestId('sidebar').getByRole('button', { name: /^投资组合(?:（|$)/ }).click();
  await page.getByTestId('portfolio-view').getByText('AAPL.US', { exact: true }).first().waitFor();
  assert.match(await page.getByTestId('portfolio-view').innerText(), /Market page fixture/);
  if (await page.getByTestId('assistant-close').isVisible()) await page.getByTestId('assistant-close').click();

    await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('sidebar').getByRole('button', { name: /^机会发现(?:（|$)/ }).click();
  await page.getByRole('tab', { name: uiText('A 股（CN）'), exact: true }).click();
  await page.getByTestId('limit-up-ladder').getByText(uiText('示例甲（Sample A）'), { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile ladder fits viewport');
  await page.screenshot({ path: resolve(artifacts, 'discover-ladder-mobile.png') });
  await page.getByTestId('sidebar').getByRole('button', { name: /^研究(?:（|$)/ }).click();
  await page.getByRole('tab', { name: uiText('A 股（CN）'), exact: true }).click();
  await page.getByTestId('research-symbol-input').fill('600519.SH');
  await page.getByTestId('research-symbol-submit').click();
  await page.getByTestId('chart-canvas').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile stock research fits viewport');
  await page.screenshot({ path: resolve(artifacts, 'research-market-mobile.png') });


    assert.deepEqual(errors, []);
    return '机会发现、自选、研究按三市场隔离；A股连板在异动前、港美明确不适用；查看个股不调用AI；组合只显示本人资产；手机宽度无溢出';
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, 'market-pages-failure.png') }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
