const { test, expect } = require('@playwright/test');

const DEFAULT = [
  'role', 'complexity.lifecycle', 'main.galaxy_info.description',
  'main.galaxy_info.galaxy_tags', 'services', 'main.dependencies', 'complexity.weight',
  'complexity.consumers', 'ressources.cpus', 'ressources.mem_limit', 'info.homepage', 'variants',
];

// Every meta/*.yml of every role is read on the first visit, which takes far
// longer than the default expect timeout on a loaded suite.
async function openMatrix(page, query = '') {
  await page.goto(`/?view=matrix${query}`);
  const rows = page.locator('table.role-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 120000 }).toBeGreaterThan(0);
  return rows;
}

const keys = page => page.locator('table.role-matrix thead tr.matrix-keys th');
const head = (page, id) => page.locator(`table.role-matrix thead tr.matrix-keys th[data-column="${id}"]`);
const heads = page => keys(page).evaluateAll(cells => cells.map(cell => cell.dataset.column));

const column = (page, id) => page.locator('table.role-matrix tbody tr')
  .evaluateAll((lines, wanted) => {
    const index = [...document.querySelectorAll('table.role-matrix thead tr.matrix-keys th')]
      .findIndex(cell => cell.dataset.column === wanted);
    return lines.map(line => line.cells[index].textContent);
  }, id);

const numbers = texts => texts.filter(text => text !== '·').map(Number);

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

test('C: a value opens its whole subtree, lists are chips', async ({ page }) => {
  await openMatrix(page, '&cols=role,services,main.galaxy_info.galaxy_tags,networks');
  const cell = page.locator('table.role-matrix tbody td.matrix-text').first();
  await cell.click();
  const detail = page.locator('.matrix-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.matrix-detail-title')).toContainText('networks');
  expect(await detail.locator('pre').textContent(), 'the subtree as YAML').toMatch(/:\s/);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  await page.locator('[data-preset="complexity"]').click();
  const plain = page.locator('table.role-matrix tbody tr').first()
    .locator(`td:nth-child(${(await heads(page)).indexOf('complexity.lifecycle') + 1})`);
  await plain.click();
  await expect(page.locator('.matrix-detail'), 'a short value shown whole opens nothing')
    .toHaveCount(0);

  const service = page.locator('table.role-matrix tbody td.matrix-chips .chip.service').first();
  await expect(service).toHaveAttribute('data-role-name', /.+/);
  expect(await page.locator('table.role-matrix tbody td.matrix-chips .chip:not(.service)').count(),
    'tags are chips too').toBeGreaterThan(0);
});

test('C: unfolding keeps the rare keys one entry away', async ({ page }) => {
  await openMatrix(page);
  await head(page, 'services').click({ button: 'right' });
  const common = page.locator('.matrix-menu button', { hasText: /^Unfold into \d+ common columns$/ });
  const all = page.locator('.matrix-menu button', { hasText: /^Unfold all \d+ \(\d+ rare\)$/ });
  const few = Number((await common.textContent()).match(/\d+/)[0]);
  const many = Number((await all.textContent()).match(/\d+/)[0]);
  expect(few).toBeGreaterThan(5);
  expect(many, 'the rare ones are most of them').toBeGreaterThan(few * 3);
  await common.click();
  const unfolded = await heads(page);
  expect(unfolded.filter(id => id.startsWith('services.')).length).toBe(few);

  await head(page, unfolded.find(id => id.startsWith('services.'))).click({ button: 'right' });
  await page.locator('.matrix-menu button', { hasText: 'Fold into services' }).click();
  expect((await heads(page)).filter(id => id.startsWith('services.')).length).toBe(0);
});

test('D: shift-click sorts by a second column', async ({ page }) => {
  await openMatrix(page);
  await head(page, 'complexity.lifecycle').click();
  await head(page, 'complexity.weight').click({ modifiers: ['Shift'] });
  await expect(head(page, 'complexity.lifecycle').locator('.matrix-sorted')).toHaveText('▲1');
  await expect(head(page, 'complexity.weight').locator('.matrix-sorted')).toHaveText('▲2');
  await expect.poll(() => page.evaluate(() => decodeURIComponent(window.location.search)))
    .toContain('order=complexity.lifecycle:asc,complexity.weight:asc');
  const pairs = await page.locator('table.role-matrix tbody tr').evaluateAll(lines => {
    const at = id => [...document.querySelectorAll('table.role-matrix thead tr.matrix-keys th')]
      .findIndex(cell => cell.dataset.column === id);
    return lines.map(line => [line.cells[at('complexity.lifecycle')].textContent,
      line.cells[at('complexity.weight')].textContent]);
  });
  let checked = 0;
  for (let index = 1; index < pairs.length; index += 1) {
    const [lifecycle, weight] = pairs[index];
    const [before, weightBefore] = pairs[index - 1];
    if (lifecycle === before && weight !== '·' && weightBefore !== '·') {
      expect(Number(weight), 'inside one lifecycle the weight rises')
        .toBeGreaterThanOrEqual(Number(weightBefore));
      checked += 1;
    }
  }
  expect(checked, 'the second key was actually compared somewhere').toBeGreaterThan(10);
});

test('D: a heading drags to a new place and its edge widens it', async ({ page }) => {
  await openMatrix(page);
  await head(page, 'info.homepage').dragTo(head(page, 'complexity.lifecycle'));
  const moved = await heads(page);
  expect(moved.indexOf('info.homepage'), 'a heading scrolled into view mid-drag still lands')
    .toBe(moved.indexOf('complexity.lifecycle') - 1);
  await expect(head(page, 'info.homepage'), 'a drag is not a click, so it does not sort')
    .not.toHaveAttribute('aria-sort', /./);

  const grip = head(page, 'services').locator('.matrix-resize');
  await head(page, 'services').scrollIntoViewIfNeeded();
  const box = await grip.boundingBox();
  const before = await head(page, 'services').evaluate(cell => cell.getBoundingClientRect().width);
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 122, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = await head(page, 'services').evaluate(cell => cell.getBoundingClientRect().width);
  expect(after - before).toBeGreaterThan(80);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mig-matrix-widths')).services))
    .toBeGreaterThan(before);
});

test('D: a role pins its card, CSV downloads the view, density switches', async ({ page }) => {
  await openMatrix(page);
  const role = page.locator('table.role-matrix tbody td.matrix-role').nth(3);
  const name = await role.getAttribute('data-role-name');
  await role.click();
  await expect(page.locator(`.role-card-host.pinned[data-role="${name}"]`))
    .toBeVisible({ timeout: 60000 });

  const download = page.waitForEvent('download');
  await page.locator('#matrix-csv').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('mig-matrix.csv');
  const lines = await page.evaluate(() => window.__mig.matrixView.download());
  expect(lines[0]).toBe(DEFAULT.join(','));
  expect(lines.length).toBe(await page.locator('table.role-matrix tbody tr').count() + 1);

  await page.locator('[data-density="comfort"]').click();
  await expect(page.locator('table.role-matrix')).toHaveClass(/density-comfort/);
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('density=comfort');
});

test('columns, order and the chip survive a reload', async ({ page }) => {
  await openMatrix(page);
  await head(page, 'main.galaxy_info.description').click();
  await page.locator('[data-preset="complexity"]').click();
  const before = await heads(page);
  const query = await page.evaluate(() => window.location.search);
  expect(query).toContain('cols=');
  expect(query).toContain('order=complexity.weight');

  await page.reload();
  await expect.poll(() => page.locator('table.role-matrix tbody tr').count(), { timeout: 120000 })
    .toBeGreaterThan(100);
  expect(await heads(page)).toEqual(before);
  await expect(page.locator('[data-preset="complexity"]')).toHaveAttribute('aria-pressed', 'true');
});
