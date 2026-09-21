const { test, expect } = require('@playwright/test');
const { boot } = require('./support/mirror');
const { pickView } = require('./support/tables');

async function open(page, query = '') {
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([]),
  }));
  await boot(page, [], query);
}

test('the app carries its own name and no toggle beside it', async ({ page }) => {
  await open(page);
  await expect(page.locator('.navbar-brand')).toContainText('Meta.Infinito.Nexus');
  expect(await page.title()).toBe('Meta.Infinito.Nexus');
  await expect(page.locator('.navbar [data-bs-target="#sidebar"]'), 'the left toggle is gone')
    .toHaveCount(0);
  await expect(page.locator('#btn-filter'), 'the filter button still opens the panel').toBeVisible();
});

test('security and items hold their views in one menu each', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btn-security + .view-menu label'), 'each entry names where it reads from')
    .toHaveText(['GitHub Alerts', 'CI Warnings']);
  await expect(page.locator('#btn-items + .view-menu label')).toHaveText(['PR']);
  await expect(page.locator('#view-warnings'), 'warnings is no longer a tab of its own')
    .toHaveCount(1);
  await expect(page.locator('.navbar input[name="view"][value="warnings"] + label.btn')).toHaveCount(0);

  await pickView(page, 'security');
  await expect(page.locator('#btn-security')).toHaveText('Security · GitHub Alerts');
  await expect.poll(() => page.evaluate(() => window.location.search), 'an old link still lands here')
    .toContain('view=security');

  await pickView(page, 'pulls');
  await expect(page.locator('#btn-items')).toHaveText('Items · PR');
});
