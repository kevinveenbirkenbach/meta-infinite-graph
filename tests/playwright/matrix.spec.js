const { test, expect } = require('@playwright/test');
const { MANIFEST, BASELINE, REGISTERED, ENV, ADMIN_FLOW, load } = require('./support/testsMatrix');

test('the env key derivation matches the shared gating helper', async ({ page }) => {
  await load(page);
  const keys = await page.evaluate(() => [
    window.PlaywrightMatrix.envKey('sso'),
    window.PlaywrightMatrix.envKey('seaweedfs'),
    window.PlaywrightMatrix.envKey('oauth2-proxy'),
  ]);
  expect(keys).toEqual(['SSO_SERVICE_ENABLED', 'SEAWEEDFS_SERVICE_ENABLED', 'OAUTH2_PROXY_SERVICE_ENABLED']);
});

test('an env template resolves lookups and admits it cannot follow a role variable', async ({ page }) => {
  await load(page);
  const flags = await page.evaluate(env => window.PlaywrightMatrix.parseEnv(env), ENV);
  expect(flags.SSO_SERVICE_ENABLED).toBe('services.sso.enabled');
  expect(flags.MATOMO_SERVICE_ENABLED).toBe('services.matomo.enabled');
  expect(flags.LDAP_SERVICE_ENABLED, 'a role variable is not followed').toBeNull();
});

test('a suite is the closure over the manifest, indentation included', async ({ page }) => {
  await load(page);
  const tests = await page.evaluate(([manifest, baseline, registered, adminFlow]) => {
    const harness = window.PlaywrightMatrix.parseHarness({ runAdminFlow: adminFlow });
    const matrix = new window.PlaywrightMatrix(harness);
    return matrix.parseSuite({
      'playwright.spec': manifest,
      'test-baseline': baseline,
      'test-mcp': registered,
    });
  }, [MANIFEST, BASELINE, REGISTERED, ADMIN_FLOW]);

  expect(tests.map(t => t.name)).toEqual([
    'baseline: responds on the canonical domain',
    'administrator: app to universal logout',
    'mcp: an unauthenticated probe is rejected',
  ]);
  expect(tests[0].skip).toEqual([]);
  expect(tests[1].branch, 'the persona flow carries its gates into the test')
    .toEqual(['logout', 'matomo', 'sso']);
  expect(tests[1].skip, 'a branch gate never skips').toEqual([]);
  expect(tests[2].skip).toEqual(['sso']);
});

test('the local requires stop at the shared harness', async ({ page }) => {
  await load(page);
  const names = await page.evaluate(m => window.PlaywrightMatrix.localRequires(m), MANIFEST);
  expect(names).toEqual(['test-baseline', 'personas']);
});

test('a variant that pins a gate off marks the test skipped, a jinja flag stays unknown', async ({ page }) => {
  await load(page);
  const rows = await page.evaluate(([registered, env]) => {
    const matrix = new window.PlaywrightMatrix({});
    const tests = matrix.parseSuite({ 'test-mcp': registered });
    const flags = window.PlaywrightMatrix.parseEnv(env);
    const of = enabled => matrix.rows('role', 0, { services: { sso: { enabled } } }, flags, tests)[0];
    return [of(true), of(false), of("{{ 'web-app-keycloak' in group_names }}")];
  }, [REGISTERED, ENV]);

  expect(rows[0].status).toBe('runs');
  expect(rows[1].status).toBe('skipped');
  expect(rows[1].reasons[0]).toContain('services.sso.enabled');
  expect(rows[2].status, 'a group_names flag is not a decision').toBe('unknown');
  expect(rows[2].reasons[0]).toContain('deployed closure');
});

test('the CI sort ranks the rows here, from the declared discovery sort',
  async ({ page }) => {
    await page.goto('/?view=tests');
    const lines = page.locator('table.tests-matrix tbody tr');
    await expect.poll(() => lines.count(), { timeout: 180000 }).toBeGreaterThan(50);

    // The spec lives in the core checkout's default.env, mounted as
    // /infinito.env. A MIG checkout without it must still render.
    const declared = await page.evaluate(() => fetch('/infinito.env')
      .then(res => (res.ok ? res.text() : ''))
      .catch(() => ''));

    await page.locator('#btn-filter').click();
    await page.selectOption('#tests-sort', 'ci');

    if (!/INFINITO_DISCOVERY_SORT/.test(declared)) {
      await expect(page.locator('.table-note')).toContainText('No INFINITO_DISCOVERY_SORT');
      await expect(lines, 'the grid survives a missing settings file').not.toHaveCount(0);
      return;
    }

    await expect(page.locator('.table-note')).toContainText('CI order derived here');
    const ranks = await page.evaluate(() => [...document.querySelectorAll(
      'table.tests-matrix tbody tr'
    )].map(tr => tr.querySelectorAll('th.tests-axis')[2].textContent.trim()));

    const numbered = ranks.filter(Boolean).map(Number);
    expect(numbered.length, 'most lines are rows CI discovers').toBeGreaterThan(50);
    expect(numbered, 'ranked lines run in rank order')
      .toEqual([...numbered].sort((a, b) => a - b));
    expect(new Set(numbered).size, 'a rank is not shared').toBe(numbered.length);

    const aware = await page.evaluate(() => Boolean(window.__mig?.testsView?.variantAware));
    if (!aware) {
      const expected = await page.evaluate(() => {
        const view = window.__mig.testsView;
        const shown = [...document.querySelectorAll(
          'table.tests-matrix tbody tr th.tests-axis:first-child'
        )].map(th => th.textContent.trim());
        return shown
          .map(role => view.best.get(role))
          .filter(Boolean)
          .map(row => row.rank)
          .sort((a, b) => a - b);
      });
      expect(numbered, 'a role line carries that role\'s earliest rank').toEqual(expected);
    }

    const firstBlank = ranks.findIndex(rank => !rank);
    const lastRanked = ranks.reduce((last, rank, i) => (rank ? i : last), -1);
    if (firstBlank !== -1) {
      expect(firstBlank, 'undiscovered lines sit behind the ranked ones')
        .toBeGreaterThan(lastRanked);
    }
  });

test('the chosen sort survives a reload through the URL', async ({ page }) => {
  await page.goto('/?view=tests&sort=ci');
  await expect.poll(
    () => page.locator('table.tests-matrix tbody tr').count(), { timeout: 180000 }
  ).toBeGreaterThan(50);
  await page.locator('#btn-filter').click();
  await expect(page.locator('#tests-sort')).toHaveValue('ci');

  // 'name' is the registered fallback, so it is the value the URL leaves out.
  await page.selectOption('#tests-sort', 'name');
  await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain('sort=');

  await page.selectOption('#tests-sort', 'ci');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('sort=ci');
});
