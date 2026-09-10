const { test, expect } = require('@playwright/test');
const { open2d, openDesign, hoverRoleWithDependencies } = require('./support/tables');

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

test('the small card lists the ressource totals like its other facts', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  // The card waits for every role's info file, which under a loaded suite
  // takes longer than the default expect timeout.
  await expect(card).toBeVisible({ timeout: 60000 });

  const memLimit = await page.evaluate(name => TableView._fmtBytes(
    window.__mig.tableView.tables.resourcesOf(name).totals.mem_limit_bytes
  ), role);
  const fact = card.locator('dl.role-card-facts dd.res-fact[data-metric="mem_limit_bytes"]');
  await expect(fact).toHaveText(memLimit);
  await expect(fact.locator('xpath=preceding-sibling::dt[1]')).toHaveText('Mem limit');
  await expect(card.locator('table.role-card-resources'), 'the table waits for the window')
    .toBeHidden();
});

test('the maximized card shows the table, and it unfolds per service', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });
  await card.hover();
  await card.locator('.role-card-grow').click();

  const table = card.locator('table.role-card-resources');
  await expect(table).toBeVisible();
  await expect(card.locator('dd.res-fact').first(), 'the facts give way to the table')
    .toBeHidden();

  const expected = await page.evaluate(name => {
    const { rows } = window.__mig.tableView.tables.resourcesOf(name);
    return { rows: rows.length, deep: rows.filter(row => row.depth > 1).length };
  }, role);
  const total = table.locator('tbody.res-total tr');
  await expect(table.locator('tbody.res-services'), 'folded until asked').toBeHidden();
  await total.click();
  await expect(total).toHaveAttribute('aria-expanded', 'true');
  await expect(table.locator('tbody.res-services tr')).toHaveCount(expected.rows);

  const indents = await table.locator('tbody.res-services td:first-child')
    .evaluateAll(cells => cells.map(cell => parseFloat(cell.style.paddingLeft)));
  expect(indents.filter(value => value > indents[0]).length,
    'shared dependencies sit indented under the role itself').toBe(expected.deep);

  await total.focus();
  await page.keyboard.press('Enter');
  await expect(table.locator('tbody.res-services'), 'the keyboard folds it back').toBeHidden();
});

test('the design panel takes the ressources out of the card', async ({ page }) => {
  await open2d(page);
  await openDesign(page);
  await page.locator('#design-resources').uncheck();
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('resources=false');
  await page.locator('#btn-design').click();

  const role = await hoverRoleWithDependencies(page);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(card.locator('table.role-card-resources')).toHaveCount(0);
  await expect(card.locator('.res-fact')).toHaveCount(0);
});

test('hovering a service in a card opens the card of the role providing it', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });

  const chip = card.locator(`dd.chips .chip.service:not([data-role-name="${role}"])`).first();
  const provider = await chip.getAttribute('data-role-name');
  const key = await chip.textContent();
  expect(await page.evaluate(k => window.__mig.tableView.tables.providerOf(k), key),
    'the chip points at the registry\'s provider, not a guess').toBe(provider);

  await card.hover();
  await chip.hover();
  await expect(page.locator(`.role-card-host[data-role="${provider}"]`)).toBeVisible();
  await expect(card, 'the first card stays while the second opens').toBeVisible();
});

test('a test card opens the provider of every gating service', async ({ page }) => {
  await open2d(page);
  const found = await page.evaluate(() => {
    const tables = window.__mig.tableView.tables;
    const key = Object.keys(tables.registry).find(name => tables.providerOf(name));
    const card = TestsView.card({
      role: 'web-app-nextcloud', test: 'probe', variant: null, gate: 'runs',
      skip: [key], branch: [], flags: ['NOT_A_SERVICE'], shared: [],
    }, window.__mig.roleInfo, undefined);
    const chips = [...card.querySelectorAll('.chip')];
    return {
      key,
      provider: tables.providerOf(key),
      gate: chips.find(chip => chip.textContent === key).dataset.roleName,
      flag: chips.find(chip => chip.textContent === 'NOT_A_SERVICE').dataset.roleName || null,
    };
  });
  expect(found.gate).toBe(found.provider);
  expect(found.flag, 'an env flag is not a service and opens nothing').toBe(null);
});

test('the maximize button spreads the card over the window and back', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });
  const before = await card.boundingBox();

  await card.hover();
  await card.locator('.role-card-grow').click();
  await expect(card).toHaveClass(/maximized/);
  const viewport = page.viewportSize();
  const spread = await card.boundingBox();
  expect(spread.width, 'nearly the whole width').toBeGreaterThan(viewport.width - 40);
  expect(spread.height, 'nearly the whole height').toBeGreaterThan(viewport.height - 40);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await expect(card, 'a maximized card does not fade when the pointer leaves').toBeVisible();

  await card.locator('.role-card-grow').click();
  await expect(card).not.toHaveClass(/maximized/);
  expect((await card.boundingBox()).width).toBeLessThan(before.width + 40);
});

test('only a role card gets the maximize button', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  await expect(page.locator(`.role-card-host[data-role="${role}"] .role-card-grow`))
    .toHaveCount(1, { timeout: 60000 });
  await page.evaluate(() => window.__mig.cardHost.show('#probe', { x: 40, y: 40 },
    () => Object.assign(document.createElement('div'), { textContent: 'probe' })));
  await expect(page.locator('.role-card-host[data-role="#probe"]')).toBeVisible();
  await expect(page.locator('.role-card-host[data-role="#probe"] .role-card-grow')).toHaveCount(0);
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
