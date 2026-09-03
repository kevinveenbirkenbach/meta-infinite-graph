const { test, expect } = require('@playwright/test');

// Bootstrap hides a .btn-check radio and puts its label on top, so the label
// is the only clickable half of the control.
async function open2d(page, view = 'bond') {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.tableView)))
    .toBe(true);
  await page.locator(`label[for="view-${view}"]`).click();
}

async function openFilters(page) {
  if (await page.locator('#sidebar').isHidden()) {
    await page.locator('#btn-filter').click();
  }
  await expect(page.locator('#sidebar')).toBeVisible();
}

async function openDesign(page) {
  if (await page.locator('#design-panel').isHidden()) {
    await page.locator('#btn-design').click();
  }
  await expect(page.locator('#design-panel')).toBeVisible();
}

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

  await page.locator('label[for="view-graph"]').click();
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

test('ressources and complexity render a row per application role', async ({ page }) => {
  await open2d(page);
  await page.locator('label[for="view-ressources"]').click();
  await expect.poll(() => page.locator('#tables tbody tr').count()).toBeGreaterThan(100);
  await expect(page.locator('#tables thead')).toContainText('mem_limit');

  await page.locator('label[for="view-complexity"]').click();
  await expect.poll(() => page.locator('#tables tbody tr').count()).toBeGreaterThan(100);
  await expect(page.locator('#tables thead')).toContainText('weight');
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

test('the theme follows the system and an explicit choice outlives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  await page.locator('#btn-design').click();
  await page.locator('#design-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
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

test('hovering a role opens a card that outlives the pointer', async ({ page }) => {
  await open2d(page);
  await openDesign(page);
  await page.locator('#btn-symbols').click();
  await expect.poll(() => page.locator('#btn-symbols').isEnabled(), { timeout: 60000 }).toBe(true);

  const rowHead = page.locator('table.bond-matrix tbody tr').first().locator('th').last();
  const role = await rowHead.getAttribute('data-role-name');
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await rowHead.hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText(role);

  await page.locator('h2').first().hover();
  await expect(card).toBeVisible();
  await expect(card).toBeHidden({ timeout: 4000 });
});

test('a second card opens without replacing the first', async ({ page }) => {
  await open2d(page);
  const heads = page.locator('table.bond-matrix tbody th[data-role-name]');
  const first = await heads.nth(0).getAttribute('data-role-name');
  const second = await heads.nth(1).getAttribute('data-role-name');

  await heads.nth(0).hover();
  await expect(page.locator(`.role-card-host[data-role="${first}"]`)).toBeVisible();
  await heads.nth(1).hover();
  await expect(page.locator(`.role-card-host[data-role="${second}"]`)).toBeVisible();
  await expect(page.locator(`.role-card-host[data-role="${first}"]`)).toBeVisible();
  expect(await page.locator('.role-card-host').count()).toBe(2);

  await expect(page.locator(`.role-card-host[data-role="${second}"] .role-card-close`))
    .toBeVisible();
  await expect
    .poll(() => page.locator(`.role-card-host[data-role="${second}"]`)
      .evaluate(el => getComputedStyle(el).opacity))
    .toBe('0.95');

  await page.locator('h2').first().hover();
  await expect.poll(() => page.locator('.role-card-host').count(), { timeout: 5000 }).toBe(0);
});

test('symbol mode reaches the siblings list and the yes/no columns', async ({ page }) => {
  await open2d(page);
  await page.locator('label[for="view-complexity"]').click();
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

test('a role with a single video plays it inside the card', async ({ page }) => {
  await open2d(page);

  const resolved = await page.evaluate(() => ({
    short: RoleInfo.embedUrl('https://youtu.be/3jcYJGQgenI?si=FDmoMSrAb9_WvviC'),
    watch: RoleInfo.embedUrl('https://www.youtube.com/watch?v=r9kR1Os1h1k'),
    list: RoleInfo.embedUrl('https://www.youtube.com/playlist?list=PLKCk3OyNwIz'),
    peertube: RoleInfo.embedUrl('https://framatube.org/w/abc123'),
    channel: RoleInfo.embedUrl('https://www.youtube.com/channel/UC_yi-5YZEf8'),
    page: RoleInfo.embedUrl('https://pgadmin.org/videos/'),
  }));
  expect(resolved.short).toBe('https://www.youtube-nocookie.com/embed/3jcYJGQgenI');
  expect(resolved.watch).toBe('https://www.youtube-nocookie.com/embed/r9kR1Os1h1k');
  expect(resolved.list).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PLKCk3OyNwIz');
  expect(resolved.peertube).toBe('https://framatube.org/videos/embed/abc123');
  expect(resolved.channel).toBeNull();
  expect(resolved.page).toBeNull();

  const role = await page.evaluate(async () => {
    const info = await window.__mig.roleInfo.load();
    const rows = [...document.querySelectorAll('table.bond-matrix tbody th[data-role-name]')];
    const hit = rows.find(th => RoleInfo.embedUrl(info.info[th.dataset.roleName]?.video || ''));
    return hit ? hit.dataset.roleName : null;
  });
  expect(role, 'no participating role declares an embeddable video').not.toBeNull();

  await page.locator(`table.bond-matrix tbody th[data-role-name="${role}"]`).hover();
  const frame = page.locator(`.role-card-host[data-role="${role}"] iframe.role-card-video`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//);
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
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

  await page.locator('label[for="view-complexity"]').click();
  await expect(page.locator('#tables thead')).toContainText('variant');
});

test('the design panel drives the font, the veil and nothing else', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-design').click();
  await expect(page.locator('#design-panel')).toBeVisible();

  const root = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      size: style.getPropertyValue('--mig-font-size').trim(),
      family: style.getPropertyValue('--mig-font-family').trim(),
      veil: style.getPropertyValue('--mig-veil').trim(),
    };
  });
  expect(await root()).toEqual({
    size: '14px',
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    veil: '0.05',
  });

  await page.locator('#design-font-size').fill('20');
  await page.locator('#design-font-size').dispatchEvent('input');
  await page.locator('#design-font-family').selectOption('mono');
  await page.locator('#design-opacity').fill('30');
  await page.locator('#design-opacity').dispatchEvent('input');

  const after = await root();
  expect(after.size).toBe('20px');
  expect(after.family).toContain('monospace');
  expect(after.veil).toBe('0.3');
  await expect(page.locator('#design-font-size-value')).toHaveText('20');
  await expect(page.locator('#design-opacity-value')).toHaveText('30');
});

test('the bottom navigator carries the status and the credits', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('#bottom-nav');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a[href*="github.com"]')).toHaveText(/Source/);
  await expect(nav.locator('a[href*="veen.world"]')).toHaveText(/Kevin/);
  await expect(nav).toContainText('MIT License');
  await expect(page.locator('#sidebar #status')).toHaveCount(0);
});

test('a facet narrows the tables, not just the graph', async ({ page }) => {
  await open2d(page, 'complexity');
  const rows = page.locator('#tables tbody tr');
  const before = await rows.count();
  expect(before).toBeGreaterThan(100);

  await openFilters(page);
  const lifecycle = page.locator('#facet-lifecycle');
  const value = await lifecycle.locator('option').nth(1).getAttribute('value');
  await lifecycle.selectOption(value);
  await expect.poll(() => rows.count()).toBeLessThan(before);
  expect(await rows.count()).toBeGreaterThan(0);

  await page.locator('label[for="view-bond"]').click();
  const axis = page.locator('table.bond-matrix tbody tr');
  await expect.poll(() => axis.count()).toBeGreaterThan(0);
  expect(await axis.count()).toBeLessThan(123);

  await lifecycle.selectOption('');
  await expect.poll(() => axis.count()).toBe(123);
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
