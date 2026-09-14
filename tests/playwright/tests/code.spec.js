const { test, expect } = require('@playwright/test');
const { pickView } = require('../support/tables');

const ROWS = 'table.code-table tbody tr.code-row';

async function open(page, view) {
  await page.goto(`/?view=${view}`);
  await expect.poll(() => page.locator(ROWS).count(), { timeout: 180000 }).toBeGreaterThan(0);
}

test('the tests menu opens the repository’s own suites, one view per suite', async ({ page }) => {
  await open(page, 'external');
  await expect(page.locator('#btn-tests'), 'the menu button names the suite on screen')
    .toHaveText('Tests · External');
  await expect(page.locator('#tables h2')).toHaveText('Tests · External');
  await expect(page.locator('#btn-tests + .view-menu label'))
    .toHaveText(['Playwright', 'CLI', 'Unit', 'Integration', 'External', 'Lint', 'Performance', 'Regression']);

  const rows = page.locator(ROWS);
  const files = await rows.count();
  expect(files, 'every test file of the suite is a row').toBeGreaterThan(5);
  await expect.poll(() => page.locator('td.code-count .cell-spin').count(), { timeout: 120000 })
    .toBe(0);
  await expect(page.locator('.table-note')).toContainText(`${files} files with`);

  const counts = await page.locator('td.code-count').allInnerTexts();
  expect(counts.every(text => /^\d+$/.test(text.trim())), 'each row counts its cases').toBe(true);
  expect(counts.some(text => Number(text) > 0), 'the suite declares cases').toBe(true);
});

test('a row opens the cases its file declares', async ({ page }) => {
  await open(page, 'external');
  await expect.poll(() => page.locator('td.code-count .cell-spin').count(), { timeout: 120000 }).toBe(0);

  const row = page.locator(ROWS).filter({ hasText: '.py' }).first();
  const name = (await row.locator('td.code-file').innerText()).trim();
  await row.click();
  const cases = page.locator('tr.code-cases li');
  await expect.poll(() => cases.count()).toBeGreaterThan(0);
  for (const text of await cases.allInnerTexts()) {
    expect(text.trim(), `${name} declares only test cases`).toMatch(/^test/);
  }

  await row.click();
  await expect(page.locator('tr.code-cases')).toHaveCount(0);
});

test('switching the suite keeps the view and the URL together', async ({ page }) => {
  await open(page, 'external');
  const external = await page.locator(ROWS).count();

  await pickView(page, 'performance');
  await expect(page.locator('#btn-tests')).toHaveText('Tests · Performance');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('view=performance');
  const performance = await page.locator(ROWS).count();
  expect(performance, 'a smaller suite has fewer files').toBeLessThan(external);

  await pickView(page, 'external');
  await expect.poll(() => page.locator(ROWS).count()).toBe(external);
});

test('a suite without a tests tree says so instead of drawing an empty table', async ({ page }) => {
  await page.route('**/infinito_tests/**', route => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/?view=lint');
  await expect(page.locator('.table-note')).toContainText('tests tree is not served', { timeout: 180000 });
  await expect(page.locator('table.code-table')).toHaveCount(0);
});
