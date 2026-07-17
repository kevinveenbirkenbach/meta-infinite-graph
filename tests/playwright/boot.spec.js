const { test, expect } = require('@playwright/test');

// Fail the run on any uncaught page error (the vendored-lib / boot-crash class
// that left the graph blank).
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
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

test('role dropdown is populated, heaviest role first', async ({ page }) => {
  await page.goto('/');
  const sel = page.locator('#sel-role');
  await expect.poll(() => sel.locator('option').count()).toBeGreaterThan(100);
  const first = await sel.locator('option').first().textContent();
  // options carry "(weight)"; the first is the heaviest and must be selected
  expect(first).toMatch(/\(\d+\)$/);
  expect(await sel.inputValue()).toBe((first || '').replace(/ \(\d+\)$/, ''));
});

test('the start role renders graph nodes and the details panel', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() => window.__mig?.graph?.graphData().nodes.length ?? 0)
    )
    .toBeGreaterThan(0);
  await expect(page.locator('#details')).toContainText('Weight');
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
