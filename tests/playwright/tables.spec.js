const { test, expect } = require('@playwright/test');

// Bootstrap hides a .btn-check radio and puts its label on top, so the label
// is the only clickable half of the control.
async function open2d(page) {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.tableView)))
    .toBe(true);
  await page.locator('label[for="mode-2d"]').click();
}

test('2D mode swaps the canvas for the tables', async ({ page }) => {
  await open2d(page);
  await expect(page.locator('#graph3d')).toBeHidden();
  await expect(page.locator('#tables-pane')).toBeVisible();
  await page.locator('label[for="mode-3d"]').click();
  await expect(page.locator('#graph3d')).toBeVisible();
  await expect(page.locator('#tables-pane')).toBeHidden();
});

test('the bond matrix is square over the participating roles', async ({ page }) => {
  await open2d(page);
  const rows = page.locator('table.bond-matrix tbody tr');
  await expect.poll(() => rows.count()).toBeGreaterThan(100);
  const roles = await rows.count();
  // One row header plus one cell per participant, and every cell carries the
  // two directions of the pair.
  await expect(rows.first().locator('td, th')).toHaveCount(roles + 1);
  await expect
    .poll(() => page.locator('table.bond-matrix .b').count())
    .toBeGreaterThan(0);
});

test('ressources and complexity render a row per application role', async ({ page }) => {
  await open2d(page);
  await page.locator('label[for="table-ressources"]').click();
  await expect.poll(() => page.locator('#tables tbody tr').count()).toBeGreaterThan(100);
  await expect(page.locator('#tables thead')).toContainText('mem_limit');

  await page.locator('label[for="table-complexity"]').click();
  await expect.poll(() => page.locator('#tables tbody tr').count()).toBeGreaterThan(100);
  await expect(page.locator('#tables thead')).toContainText('weight');
});

test('the theme follows the system and an explicit choice outlives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  await expect(page.locator('#btn-theme')).toHaveText('☀️');

  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
  await expect(page.locator('#btn-theme')).toHaveText('🌙');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
});

test('the service registry resolves bond keys to provider roles', async ({ page }) => {
  await open2d(page);
  const resolved = await page.evaluate(() => {
    const tables = window.__mig.tableView.tables;
    return {
      mariadb: tables.providerOf('mariadb'),
      entity: tables.entityName('svc-db-mariadb'),
      edges: tables.bondEdges().size,
    };
  });
  expect(resolved.entity).toBe('mariadb');
  expect(resolved.mariadb).toBe('svc-db-mariadb');
  expect(resolved.edges).toBeGreaterThan(500);
});
