const { test, expect } = require('@playwright/test');

// Fail the run on any uncaught page error (the vendored-lib / boot-crash class
// that left the graph blank). A 404 is not one: a role file the loader treats
// as optional is absent for 47 of the roles, and the browser logs every miss.
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      errors.push(m.text());
    }
  });
  return errors;
}

test('boots without JS errors and the libs are defined', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => typeof window.ForceGraph3D))
    .toBe('function');
  await expect
    .poll(() => page.evaluate(() => typeof window.jsyaml))
    .toBe('object');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a URL key registered twice fails loudly instead of feeding two setters', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => typeof window.UrlState)).toBe('function');
  const outcome = await page.evaluate(() => {
    const state = new UrlState();
    state.register('probe', () => 'a', () => {}, '');
    try {
      state.register('probe', () => 'b', () => {}, '');
      return 'accepted';
    } catch (error) {
      return error.message;
    }
  });
  expect(outcome).toContain("URL key 'probe' is registered twice");
});

test('role dropdown is populated, heaviest role first', async ({ page }) => {
  await page.goto('/');
  const sel = page.locator('#sel-role');
  await expect.poll(() => sel.locator('option').count()).toBeGreaterThan(100);
  const first = await sel.locator('option').first().textContent();
  // options carry "(weight)"; the first is the heaviest and must be selected
  expect(first).toMatch(/\(\d+\)$/);
  expect(await sel.inputValue()).toBe((first || '').replace(/ \(\d+\)$/, ''));
});

test('clicking a graph node pins its card until it is closed', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() => window.__mig?.graph?.graphData().nodes.length ?? 0)
    )
    .toBeGreaterThan(0);

  const role = await page.evaluate(() => {
    const node = window.__mig.graph.graphData().nodes[0];
    window.__mig.cardHost.pin(node.id, () => ({ x: 100, y: 100 }));
    return node.id;
  });
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Weight');
  await expect(card).toContainText(role);

  await page.evaluate(role => window.__mig.cardHost.pin(role, () => ({ x: 100, y: 100 })), role);
  await expect(card).toBeVisible();

  await card.locator('.popup-close').click();
  await expect(card).toBeHidden({ timeout: 3000 });
});

test('facet filters are populated from scanned metadata', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() => page.locator('#facet-author option').count())
    .toBeGreaterThan(1);
  await expect
    .poll(() => page.locator('#facet-mode option').count())
    .toBeGreaterThan(1);
});

test('auto-iteration expands pending nodes over time', async ({ page }) => {
  await page.goto('/');
  const expanded = () =>
    page.evaluate(() => window.__mig?.selectionManager.loadedRoles.size ?? 0);
  await expect.poll(expanded).toBeGreaterThan(0);
  const before = await expanded();
  await expect.poll(expanded, { timeout: 20000 }).toBeGreaterThan(before);
});
