const { test, expect } = require('@playwright/test');
const { pickView, open2d, openFilters, openDesign } = require('./support/tables');

test('the idle mode stays behind the active one at 0.95', async ({ page }) => {
  await open2d(page);
  const graph = page.locator('#graph3d');
  const pane = page.locator('#tables-pane');
  const style = locator => locator.evaluate(el => {
    const computed = getComputedStyle(el);
    return { opacity: computed.opacity, z: computed.zIndex, events: computed.pointerEvents };
  });

  await expect(pane).toHaveClass(/pane-front/);
  await expect(graph).toHaveClass(/pane-back/);
  expect(await style(pane)).toEqual({ opacity: '0.95', z: '900', events: 'auto' });
  expect(await style(graph)).toEqual({ opacity: '1', z: '800', events: 'none' });
  await expect(graph).toBeVisible();

  await pickView(page, 'graph');
  await expect(graph).toHaveClass(/pane-front/);
  await expect(pane).toHaveClass(/pane-back/);
  expect(await style(graph)).toEqual({ opacity: '0.95', z: '900', events: 'auto' });
  expect(await style(pane)).toEqual({ opacity: '1', z: '800', events: 'none' });
  await expect(pane).toBeVisible();
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

test('roles gathers cosmos, bond and the matrix; ressources and complexity have no tab',
  async ({ page }) => {
    await open2d(page);
    expect(await page.locator('#view-ressources').count(), 'the ressources moved into the card')
      .toBe(0);
    expect(await page.locator('#view-complexity').count(), 'complexity is a matrix filter')
      .toBe(0);
    await expect(page.locator('.roles-menu label')).toHaveText(['Cosmos', 'Bond', 'Matrix']);
    await expect(page.locator('#btn-roles')).toHaveText('Roles · Bond');
  });

test('hover crosses the pair in yellow, a click locks it in violet', async ({ page }) => {
  await open2d(page);
  const rows = page.locator('table.bond-matrix tbody tr');
  await expect.poll(() => rows.count()).toBeGreaterThan(100);

  const row = rows.nth(3);
  const rowHead = row.locator('th');
  const columnHead = page.locator('table.bond-matrix thead th').nth(6);
  const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);

  await row.locator('td').nth(5).hover();
  await expect.poll(() => background(rowHead)).toBe('rgb(255, 212, 0)');
  await expect.poll(() => background(columnHead)).toBe('rgb(255, 212, 0)');

  await row.locator('td').nth(5).click();
  await expect.poll(() => background(rowHead)).toBe('rgb(168, 85, 247)');
  await expect.poll(() => background(columnHead)).toBe('rgb(168, 85, 247)');

  await row.locator('td').nth(5).click();
  await expect.poll(() => background(rowHead)).toBe('rgb(255, 212, 0)');
});

test('a bond of 1 is the opposite of the page in either theme', async ({ page }) => {
  await open2d(page);
  const bar = page.locator('table.bond-matrix .b').first();
  await expect.poll(() => bar.count()).toBeGreaterThan(0);
  const background = () => bar.evaluate(el => getComputedStyle(el).backgroundColor);
  const luminance = colour => {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const themeNow = await page.locator('html').getAttribute('data-bs-theme');
  const before = luminance(await background());
  await page.locator('#btn-design').click();
  await page.locator('#design-theme')
    .selectOption(themeNow === 'dark' ? 'light' : 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-bs-theme', themeNow);
  const after = luminance(await background());
  expect(Math.abs(before - after)).toBeGreaterThan(60);
});

test('the symbol switch replaces role names with icons', async ({ page }) => {
  await open2d(page);
  const firstRowHead = page.locator('table.bond-matrix tbody tr').first().locator('th').last();
  await expect(firstRowHead).toHaveText(/[a-z]/);

  await openDesign(page);
  await page.locator('#btn-symbols').click();
  await expect.poll(
    () => firstRowHead.locator('img.role-icon, i.role-icon').count(),
    { timeout: 60000 }
  ).toBe(1);
  await expect(firstRowHead).toHaveText('');
});

test('symbol mode reaches the siblings list and the yes/no columns', async ({ page }) => {
  await page.goto('/?view=matrix&complexity=true&order=complexity.weight:desc'
    + '&cols=role,complexity.integrated,complexity.siblings');
  await expect.poll(() => page.locator('table.role-matrix tbody tr').count(), { timeout: 90000 })
    .toBeGreaterThan(100);
  const siblings = page.locator('#tables tbody tr').first().locator('td').last();
  await expect(siblings).toHaveText(/[a-z]/);

  await openDesign(page);
  await page.locator('#btn-symbols').click();
  await expect.poll(
    () => page.locator('#tables td.role-list [data-role-name]').count(),
    { timeout: 60000 }
  ).toBeGreaterThan(0);
  await expect(page.locator('#tables td.role-list').first()).toHaveText('');
  await expect
    .poll(() => page.locator('#tables td.bool i.fa-check, #tables td.bool i.fa-xmark').count())
    .toBeGreaterThan(0);

  const sibling = page.locator('#tables td.role-list [data-role-name]').first();
  const role = await sibling.getAttribute('data-role-name');
  await sibling.hover();
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.role-card-title')).toContainText(role);
});

test('variant awareness adds a variant axis to every table', async ({ page }) => {
  await open2d(page);
  const rows = page.locator('table.bond-matrix tbody tr');
  const before = await rows.count();

  await openFilters(page);
  await page.locator('#btn-variants').click();
  await expect.poll(
    () => page.locator('table.bond-matrix th.variant-head').count(),
    { timeout: 90000 }
  ).toBeGreaterThan(0);
  expect(await rows.count()).toBeGreaterThan(before);

  await pickView(page, 'matrix');
  await expect(page.locator('table.role-matrix thead')).toContainText('variant', { timeout: 90000 });
});

test('a facet narrows the tables, not just the graph', async ({ page }) => {
  await open2d(page, 'matrix');
  const rows = page.locator('table.role-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 90000 }).toBeGreaterThan(100);
  const before = await rows.count();
  expect(before).toBeGreaterThan(100);

  await openFilters(page);
  const lifecycle = page.locator('#facet-lifecycle');
  const value = await lifecycle.locator('option').nth(1).getAttribute('value');
  await lifecycle.selectOption(value);
  await expect.poll(() => rows.count()).toBeLessThan(before);
  expect(await rows.count()).toBeGreaterThan(0);

  await pickView(page, 'bond');
  const axis = page.locator('table.bond-matrix tbody tr');
  await expect.poll(() => axis.count()).toBeGreaterThan(0);
  expect(await axis.count()).toBeLessThan(123);

  await lifecycle.selectOption('');
  await expect.poll(() => axis.count()).toBe(123);
});

test('a reload restores the view, the filters and the design', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.tableView)), { timeout: 60000 })
    .toBe(true);

  await openFilters(page);
  await page.locator('#edge-run-after').check();
  const lifecycle = page.locator('#facet-lifecycle');
  const value = await lifecycle.locator('option').nth(1).getAttribute('value');
  await lifecycle.selectOption(value);
  await pickView(page, 'matrix');
  await expect.poll(() => page.locator('table.role-matrix tbody tr').count(), { timeout: 90000 })
    .toBeGreaterThan(0);
  await page.locator('[data-preset="complexity"]').click();

  await openDesign(page);
  await page.locator('#design-font-size').fill('18');
  await page.locator('#design-font-size').dispatchEvent('input');
  await page.locator('#design-font-family').selectOption('mono');
  await page.locator('#design-theme').selectOption('dark');
  await page.locator('#btn-symbols').click();
  await expect.poll(() => page.locator('#btn-symbols').isEnabled(), { timeout: 60000 }).toBe(true);

  const before = await page.evaluate(() => window.location.search);
  expect(before).toContain('view=matrix');
  expect(before).toContain('complexity=true');
  expect(before).toContain('symbols=true');
  expect(before).toContain('fontsize=18');
  expect(before).toContain('font=mono');
  expect(before).toContain('theme=dark');
  expect(before).toContain('run-after');
  const rows = await page.locator('#tables tbody tr').count();

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.tableView)), { timeout: 60000 })
    .toBe(true);
  await expect.poll(() => page.locator('#tables tbody tr').count()).toBe(rows);
  await expect(page.locator('#view-matrix')).toBeChecked();
  await expect(page.locator('[data-preset="complexity"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  await expect(page.locator('#edge-run-after')).toBeChecked();
  expect(await page.evaluate(() => window.__mig.roleInfo.symbols)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--mig-font-size').trim())).toBe('18px');
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
