const { test, expect } = require('@playwright/test');
const { pickView } = require('../support/tables');

test('the grid puts role and variant on one axis and the tests on the other', async ({ page }) => {
  await page.goto('/?view=playwright');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  const shape = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('table.tests-matrix tbody tr')];
    const headers = [...document.querySelectorAll('table.tests-matrix thead th')]
      .map(th => th.textContent.trim());
    const widths = new Set(lines.map(tr => tr.querySelectorAll('td').length));
    return {
      lines: lines.length,
      headers,
      filled: document.querySelectorAll('table.tests-matrix td[data-cell]').length,
      blank: document.querySelectorAll('table.tests-matrix td.tests-blank').length,
      widths: [...widths],
      axisPerLine: [...new Set(lines.map(tr => tr.querySelectorAll('th.tests-axis').length))],
    };
  });

  expect(shape.headers.slice(0, 3)).toEqual(['role', 'variant', 'rank']);
  expect(shape.headers.slice(3), 'the test axis is numbered').toEqual(
    shape.headers.slice(3).map((_, i) => String(i + 1))
  );
  expect(shape.axisPerLine, 'every line carries the same three axis cells').toEqual([3]);
  expect(shape.widths, 'the grid is rectangular').toHaveLength(1);
  expect(shape.filled + shape.blank, 'every slot is either a test or blank')
    .toBe(shape.lines * shape.widths[0]);
  expect(shape.lines, 'one line per role, not per test').toBeLessThan(shape.filled);
});

test('hovering a cell opens a card with that run’s detail', async ({ page }) => {
  await page.goto('/?view=playwright');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  await cells.first().hover();
  const card = page.locator('.role-card-host .test-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Variant');
  await expect(card).toContainText('Gate');
  await expect(page.locator('.role-card-host .role-card-close')).toBeVisible();

  const named = await page.evaluate(() => {
    const cell = document.querySelector('table.tests-matrix td[data-cell]');
    const role = cell.closest('tr').querySelector('th.tests-axis').textContent.trim();
    return { role, card: document.querySelector('.test-card').textContent };
  });
  expect(named.card, 'the card names the role of its own cell').toContain(named.role);

  // The card must not sit on the cell it explains, or the pointer cannot leave.
  const clear = await page.evaluate(() => {
    const host = document.querySelector('.role-card-host').getBoundingClientRect();
    const cell = document.querySelector('table.tests-matrix td[data-cell]').getBoundingClientRect();
    return host.left >= cell.right || host.right <= cell.left
      || host.top >= cell.bottom || host.bottom <= cell.top;
  });
  expect(clear).toBe(true);

  await page.mouse.move(2, 2);
  await expect(page.locator('.role-card-host')).toHaveCount(0);
});

test('the tests menu moves between the playwright and the cli suites', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(300);
  const playwrightRows = await rows.count();
  await expect(page.locator('#btn-tests'), 'an old ?view=tests link opens the playwright suite')
    .toHaveText('Tests · Playwright');
  await expect(page.locator('#btn-tests + .view-menu label')).toHaveText(['Playwright', 'CLI']);

  await pickView(page, 'cli');
  await expect(page.locator('#btn-tests')).toHaveText('Tests · CLI');
  await expect(page.locator('#tables h2')).toHaveText('Tests · CLI');
  await expect(page.locator('.table-note')).toContainText('CLI runs across');
  await expect(page.locator('.table-note')).toContainText(
    'CLI tests declare no <NAME>_SERVICE_ENABLED flags'
  );

  const cliRows = await rows.count();
  expect(cliRows, 'far fewer roles ship a CLI test').toBeLessThan(playwrightRows);
  expect(cliRows).toBeGreaterThan(0);
  // One script per role, so the CLI grid is a single column.
  await expect(page.locator('table.tests-matrix thead th')).toHaveText(
    ['role', 'variant', 'rank', '1']
  );

  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('view=cli');

  await pickView(page, 'playwright');
  await expect.poll(() => rows.count()).toBe(playwrightRows);
});

test('the note counts every run, whatever the grid shows', async ({ page }) => {
  await page.goto('/?view=playwright');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  await page.locator('#btn-filter').click();
  await page.locator('#btn-variants').click();
  await expect.poll(() => cells.count(), { timeout: 60000 }).toBeGreaterThan(1000);

  await expect(page.locator('.table-note')).toContainText('test runs across');
  await expect(page.locator('.table-note'))
    .toContainText('never run because a gate is off in every variant');
  await expect(page.locator('.table-note'))
    .toContainText('skipped only in their own variant');
  await expect(page.locator('.table-note'))
    .toContainText('never certain because no variant settles their gate');

  expect(await page.locator('table.tests-matrix td.pw-skipped').count()).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix th[data-role-name]').first().count(),
    'the role axis carries the hover card trigger').toBe(1);
});
