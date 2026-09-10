const { test, expect } = require('@playwright/test');
const { DEFAULT, openMatrix, head, heads } = require('./support/matrixView');

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
