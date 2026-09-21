const { test, expect } = require('@playwright/test');
const { pickView } = require('./support/tables');
const { boot } = require('./support/feeds');

test('the commits tab merges the ticked refs and drops the duplicate', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main,next');
  await page.locator('label[for="view-commits"]').click();

  const rows = page.locator('table.commits-table tbody tr');
  await expect.poll(() => rows.count()).toBe(3);
  await expect(rows.first().locator('td').nth(4)).toHaveText('newest on main');
  await expect(rows.last().locator('td').nth(4), 'newest first').toHaveText('only on next');
  await expect(page.locator('.table-note'),
    'the duplicate is merged away, and the note says how many rows it came from')
    .toContainText('merged from 4 rows');
  expect(calls.filter(one => one.startsWith('log:')).sort()).toEqual(['log:main', 'log:next']);
});

test('a ref nobody ticked is never walked', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await page.locator('label[for="view-commits"]').click();
  await expect.poll(() => page.locator('table.commits-table tbody tr').count()).toBe(2);
  expect(calls.filter(one => one.startsWith('log:'))).toEqual(['log:main']);
});

test('the PR tab keeps what the range covers and links the rest out', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main,f1/master');
  await pickView(page, 'pulls');

  const rows = page.locator('table.feed-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(2);
  await expect(page.locator('.table-note')).toContainText('2 of 4 in this window');
  await expect(rows.first().locator('td').nth(4)).toContainText('recent in');
  await expect(rows.first().locator('td a')).toHaveAttribute('href', /\/pull\/7$/);

  expect(calls.filter(one => one.endsWith('/pulls')).sort(),
    'one call per ticked repository, not per ref').toEqual([
    '/repos/infinito-nexus/core/pulls', '/repos/someone/core/pulls',
  ]);
});

test('the actions tab reads the runs and marks the conclusion', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await page.locator('label[for="view-actions"]').click();

  const rows = page.locator('table.feed-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(1);
  await expect(rows.first().locator('td.feed-mark')).toHaveText('success');
  await expect(rows.first().locator('td.feed-mark')).toHaveClass(/feed-success/);
  expect(await rows.first().locator('td.feed-mark').evaluate(cell => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--bs-success)';
    const success = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(cell).color === success;
  }), 'the table style must not paint over the conclusion').toBe(true);
  expect(calls.filter(one => one.endsWith('/actions/runs')))
    .toEqual(['/repos/infinito-nexus/core/actions/runs']);
});

test('leaving and returning to a feed spends no second request', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await pickView(page, 'pulls');
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 })
    .toBe(1);
  const spent = calls.filter(one => one.endsWith('/pulls')).length;
  expect(spent).toBe(1);

  await page.locator('label[for="view-actions"]').click();
  await expect.poll(() => page.locator('table.feed-table tbody tr').count()).toBe(1);
  await pickView(page, 'pulls');
  await expect.poll(() => page.locator('table.feed-table tbody tr').count()).toBe(1);

  expect(calls.filter(one => one.endsWith('/pulls')).length,
    'the cache answers the second visit').toBe(spent);
});

test('a feed with nothing ticked asks GitHub nothing at all', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=none/at-all');
  await pickView(page, 'pulls');
  await expect(page.locator('.table-note')).toContainText('No source ticked');
  expect(calls.filter(one => one.endsWith('/pulls'))).toEqual([]);
});
