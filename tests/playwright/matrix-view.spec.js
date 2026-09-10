const { test, expect } = require('@playwright/test');
const { DEFAULT, openMatrix, head, heads, column, numbers } = require('./support/matrixView');

test('the matrix opens with twelve informative columns, one row per role', async ({ page }) => {
  const rows = await openMatrix(page);
  expect(await heads(page)).toEqual(DEFAULT);
  const roles = await page.evaluate(() => Object.keys(window.__mig.matrixView.meta).length);
  expect(await rows.count(), 'every role with a meta/ directory, not only applications')
    .toBeGreaterThan(200);
  expect(await rows.count()).toBe(roles);
  const names = await column(page, 'role');
  expect(names, 'a directory without meta/*.yml is not a role').not.toContain('__pycache__');
  expect(names).not.toContain('.claude');
  for (const id of await heads(page)) {
    if (id === 'role') continue;
    expect(await page.evaluate(column => window.__mig.matrixView.distinct(column), id),
      `${id} tells the roles apart`).toBeGreaterThan(1);
  }
});

test('A: the role column stays, the heading reads as group and key', async ({ page }) => {
  await openMatrix(page);
  const first = page.locator('table.role-matrix tbody tr').first().locator('td').first();
  expect(await first.evaluate(cell => getComputedStyle(cell).position)).toBe('sticky');

  const galaxy = page.locator('table.role-matrix thead tr.matrix-groups th[data-group="main.galaxy_info"]');
  await expect(galaxy).toHaveText('main.galaxy_info');
  expect(await galaxy.getAttribute('colspan'), 'adjacent keys of one map share one group cell')
    .toBe('2');
  await expect(head(page, 'main.galaxy_info.description').locator('.matrix-label'))
    .toHaveText('description');
  await expect(head(page, 'main.galaxy_info.description')).toHaveAttribute(
    'title', 'main.galaxy_info.description'
  );
  await expect(head(page, 'info.homepage').locator('.matrix-fill')).toHaveText(/^\d+%$/);
  expect(await page.locator('table.role-matrix td.matrix-empty').first().textContent()).toBe('·');
});

test('A: a heading sorts ascending, then descending, empty last', async ({ page }) => {
  await openMatrix(page);
  const weight = head(page, 'complexity.weight');
  await weight.click();
  await expect(weight).toHaveAttribute('aria-sort', 'ascending');
  const up = numbers(await column(page, 'complexity.weight'));
  expect(up).toEqual([...up].sort((one, other) => one - other));

  await weight.click();
  await expect(weight).toHaveAttribute('aria-sort', 'descending');
  const down = numbers(await column(page, 'complexity.weight'));
  expect(down).toEqual([...down].sort((one, other) => other - one));
  expect((await column(page, 'complexity.weight')).slice(-1)[0],
    'roles without a value sort last in either direction').toBe('·');
});

test('B: the search narrows the rows over the visible columns', async ({ page }) => {
  const rows = await openMatrix(page);
  const before = await rows.count();
  await page.locator('#matrix-find').fill('nextcloud');
  await expect.poll(() => rows.count()).toBeLessThan(before);
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator('.matrix-section .table-note')).toContainText(`of ${before} rows`);
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('find=nextcloud');
  await page.locator('#matrix-find').fill('');
  await expect.poll(() => rows.count()).toBe(before);
});

test('B: presets swap the column set and show which one is active', async ({ page }) => {
  await openMatrix(page);
  await expect(page.locator('[data-preset="overview"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-preset="galaxy"]').click();
  expect(await heads(page)).toContain('main.galaxy_info.license');
  await expect(page.locator('[data-preset="galaxy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-preset="overview"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-preset="ressources"]').click();
  expect(await heads(page)).toEqual(['role', 'services', 'ressources.cpus',
    'ressources.mem_reservation', 'ressources.mem_limit', 'ressources.min_storage',
    'ressources.pids_limit']);
});

test('B: the complexity chip adds its columns and orders heaviest first', async ({ page }) => {
  await openMatrix(page);
  const chip = page.locator('[data-preset="complexity"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const on = await heads(page);
  for (const id of ['complexity.embeds', 'complexity.integrated', 'complexity.clone',
    'complexity.siblings']) {
    expect(on, id).toContain(id);
  }
  await expect(head(page, 'complexity.weight')).toHaveAttribute('aria-sort', 'descending');
  const weights = numbers(await column(page, 'complexity.weight'));
  expect(weights).toEqual([...weights].sort((one, other) => other - one));

  await page.locator('[data-preset="complexity"]').click();
  expect(await heads(page), 'the columns the default carries stay').toEqual(DEFAULT);
});

test('B: the columns button and the design panel list every column', async ({ page }) => {
  await openMatrix(page);
  await page.locator('#matrix-columns-button').click();
  const picker = page.locator('.matrix-picker .matrix-columns');
  expect(await picker.locator('input[type="checkbox"]').count()).toBeGreaterThan(500);
  expect(await picker.locator('input:checked').count()).toBe(DEFAULT.length);
  await page.locator('.matrix-picker input[type="search"]').fill('license');
  await expect(picker.locator('label', { hasText: 'main.galaxy_info.license' })
    .locator('.matrix-const'), 'a search reaches below the top-level keys, and a column '
    + 'with one value for all is marked').toHaveText('constant');
  await page.locator('.matrix-picker input[type="search"]').fill('ressources.');
  await picker.locator('input[data-column="ressources.pids_limit"]').check();
  expect(await heads(page)).toContain('ressources.pids_limit');

  await page.locator('#btn-design').click();
  const list = page.locator('#matrix-columns');
  await list.locator('input[data-column="ressources.pids_limit"]').uncheck();
  expect(await heads(page)).not.toContain('ressources.pids_limit');
  await page.locator('#matrix-columns-reset').click();
  expect(await heads(page)).toEqual(DEFAULT);
});

test('B: the column menu opens from ⋮ as well as from a right-click', async ({ page }) => {
  await openMatrix(page);
  await head(page, 'info.homepage').hover();
  await head(page, 'info.homepage').locator('.matrix-more').click();
  await page.locator('.matrix-menu button', { hasText: 'Remove this column' }).click();
  expect(await heads(page)).not.toContain('info.homepage');

  await head(page, 'services').click({ button: 'right' });
  await page.locator('.matrix-menu input[type="search"]').fill('main.galaxy_info.author');
  await page.locator('.matrix-menu .matrix-menu-list button', { hasText: /^main\.galaxy_info\.author$/ })
    .click();
  const added = await heads(page);
  expect(added.indexOf('main.galaxy_info.author'), 'added right after the column clicked')
    .toBe(added.indexOf('services') + 1);
});
