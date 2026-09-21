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

test('security holds alerts, warnings and CSP', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btn-security + .view-menu label'), 'each entry names where it reads from')
    .toHaveText(['GitHub Alerts', 'CI Warnings', 'CSP']);
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

test('the CSP view lists every exception a role declares, worst first', async ({ page }) => {
  // Every role's meta/csp.yml is read before the table draws, which outlasts
  // the default timeout on a loaded machine.
  test.slow();
  await open(page, '?view=csp');
  const rows = page.locator('table.csp-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(50);
  await expect(page.locator('#btn-security')).toHaveText('Security · CSP');
  await expect(page.locator('.table-note')).toContainText('exceptions to the default policy');

  const kinds = await page.locator('table.csp-table tbody td:first-child').allInnerTexts();
  // Anything a role writes that this app did not classify sorts after the
  // classes it knows, so a new token never jumps the queue.
  const known = ['unsafe-eval', 'unsafe-inline', 'wildcard', 'scheme', 'host'];
  const seen = kinds.map(text => (known.indexOf(text.trim()) + 1 || 6) - 1);
  expect(kinds.filter(text => text.trim() === 'unsafe-eval').length, 'the loudest flag is listed')
    .toBeGreaterThan(10);
  expect(kinds.filter(text => text.trim() === 'unsafe-inline').length).toBeGreaterThan(50);
  expect(seen, 'the loudest exceptions come first').toEqual([...seen].sort((a, b) => a - b));

  const inline = rows.filter({ hasText: 'unsafe-inline' }).first();
  await expect(inline, 'a flag names the directive it opens').toContainText('script-src');
  await expect(inline, 'the reason the nocheck marker carries survives the parse')
    .toContainText('historical');

  await page.locator('select[data-filter="kind"]').selectOption('wildcard');
  await expect.poll(() => rows.count()).toBeGreaterThan(0);
  const narrowed = await page.locator('table.csp-table tbody td:first-child').allInnerTexts();
  expect([...new Set(narrowed.map(text => text.trim()))]).toEqual(['wildcard']);
  await expect(rows.first()).toContainText('*');
});
