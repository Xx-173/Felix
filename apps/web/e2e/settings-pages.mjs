import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// An independent workspace keeps the full acceptance run within per-user limits.
export async function verifySettingsPages(browser, origin, artifacts) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sidebar').waitFor();
    await page.getByTestId('assistant-close').click();
    await page.getByTestId('sidebar').getByRole('button', { name: /^设置（/ }).click();
    assert.equal(await page.getByTestId('sidebar').getByRole('button', { name: /^技能（|^评测（/ }).count(), 0);
    const menu = page.getByTestId('settings-menu');
    assert.equal(await menu.getByRole('tablist').getAttribute('aria-orientation'), 'vertical');
    const menuBox = await menu.boundingBox(), cardBox = await page.locator('.felix-settings-card').boundingBox();
    assert.ok(cardBox.x > menuBox.x + menuBox.width);
    for (const label of ['数据源', '系统设置', '研究工具', '研究表现', '研究评测', '运行追踪', '系统诊断']) {
      await menu.getByRole('tab', { name: new RegExp('^' + label + '（') }).click();
      assert.equal(await page.getByText('Something went wrong', { exact: true }).count(), 0);
    }
    await menu.getByRole('tab', { name: /^系统诊断（/ }).press('Home');
    assert.equal(await menu.getByRole('tab', { name: /^数据源（/ }).getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: resolve(artifacts, 'settings-categories-light.png') });
    await page.getByTestId('settings-menu-collapse').click();
    await page.reload();
    await page.getByTestId('sidebar').getByRole('button', { name: /^设置（/ }).click();
    await page.locator('.felix-settings-menu.is-collapsed').waitFor();
    await page.getByTestId('settings-menu-collapse').click();
    assert.ok(await page.getByTestId('assistant-bull-icon').evaluate((image) => image.complete && image.naturalWidth > 0));
    await page.getByRole('button', { name: '切换深色主题（Dark theme）', exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(artifacts, 'settings-categories-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(artifacts, 'settings-categories-mobile.png') });
    await menu.getByRole('tab', { name: /^AI 设置（/ }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: resolve(artifacts, 'settings-models-mobile.png') });
    return '设置左侧分类、键盘导航、折叠记忆、高级工具与牛市图标正常，明暗主题和手机布局通过';
  } finally { await context.close(); }
}
