const { test, expect } = require('@playwright/test');

const MANIFEST = `
const { test } = require("@playwright/test");
require("./test-baseline");
require("./personas");
`;

const BASELINE = `
const { test, expect } = require("@playwright/test");
const { runAdminFlow } = require("./personas");

test("baseline: responds on the canonical domain", async ({ page }) => {
  await page.goto("/");
});

test("administrator: app to universal logout", async ({ page }) => {
  await runAdminFlow(page);
});
`;

// The third shape found in the tree: tests registered from inside a wrapper,
// so the `test(` is indented and a line-anchored split would miss it.
const REGISTERED = `
const { test } = require("@playwright/test");
const { skipUnlessServiceEnabled } = require("./service-gating");

exports.register = function (shared) {
  test("mcp: an unauthenticated probe is rejected", async ({ request }) => {
    skipUnlessServiceEnabled("sso");
    await request.post(shared.url());
  });
};
`;

const ENV = `
SSO_SERVICE_ENABLED={{ lookup('config', application_id, 'services.sso.enabled') | string | lower }}
LOGOUT_SERVICE_ENABLED={{ lookup('config', application_id, 'services.logout.enabled') | string | lower }}
MATOMO_SERVICE_ENABLED={{ lookup('config', application_id, 'services.matomo.enabled') | string | lower }}
LDAP_SERVICE_ENABLED={{ ZAMMAD_LDAP_ENABLED | string | lower }}
`;

const ADMIN_FLOW = `
async function runAdminFlow(page, opts = {}) {
  safeIsEnabled("sso");
  safeIsEnabled("logout");
  safeIsEnabled("matomo");
}
module.exports = { runAdminFlow };
`;

async function load(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.PlaywrightMatrix), null, { timeout: 60000 });
}

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

test('the grid puts role and variant on one axis and the tests on the other', async ({ page }) => {
  await page.goto('/?view=tests');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  const shape = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('table.tests-matrix tbody tr')];
    const headers = [...document.querySelectorAll('table.tests-matrix thead th')]
      .map(th => th.textContent.trim());
    const widths = new Set(lines.map(tr => tr.querySelectorAll('td').length));
    return {
      lines: lines.length,
      headers,
      filled: document.querySelectorAll('table.tests-matrix td[data-cell]').length,
      blank: document.querySelectorAll('table.tests-matrix td.tests-blank').length,
      widths: [...widths],
      axisPerLine: [...new Set(lines.map(tr => tr.querySelectorAll('th.tests-axis').length))],
    };
  });

  expect(shape.headers.slice(0, 3)).toEqual(['role', 'variant', 'rank']);
  expect(shape.headers.slice(3), 'the test axis is numbered').toEqual(
    shape.headers.slice(3).map((_, i) => String(i + 1))
  );
  expect(shape.axisPerLine, 'every line carries the same three axis cells').toEqual([3]);
  expect(shape.widths, 'the grid is rectangular').toHaveLength(1);
  expect(shape.filled + shape.blank, 'every slot is either a test or blank')
    .toBe(shape.lines * shape.widths[0]);
  expect(shape.lines, 'one line per role, not per test').toBeLessThan(shape.filled);
});

test('hovering a cell opens a card with that run’s detail', async ({ page }) => {
  await page.goto('/?view=tests');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  await cells.first().hover();
  const card = page.locator('.role-card-host .test-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Variant');
  await expect(card).toContainText('Gate');
  await expect(page.locator('.role-card-host .role-card-close')).toBeVisible();

  const named = await page.evaluate(() => {
    const cell = document.querySelector('table.tests-matrix td[data-cell]');
    const role = cell.closest('tr').querySelector('th.tests-axis').textContent.trim();
    return { role, card: document.querySelector('.test-card').textContent };
  });
  expect(named.card, 'the card names the role of its own cell').toContain(named.role);

  // The card must not sit on the cell it explains, or the pointer cannot leave.
  const clear = await page.evaluate(() => {
    const host = document.querySelector('.role-card-host').getBoundingClientRect();
    const cell = document.querySelector('table.tests-matrix td[data-cell]').getBoundingClientRect();
    return host.left >= cell.right || host.right <= cell.left
      || host.top >= cell.bottom || host.bottom <= cell.top;
  });
  expect(clear).toBe(true);

  await page.mouse.move(2, 2);
  await expect(page.locator('.role-card-host')).toHaveCount(0);
});

test('the gate filter partitions the cells across its five marks', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(300);

  // The two per-variant marks need more than one variant to exist at all, so
  // the five-way split is only observable with the variants switch on.
  await page.locator('#btn-filter').click();
  await page.locator('#btn-variants').click();
  await expect.poll(() => rows.count(), { timeout: 60000 }).toBeGreaterThan(1000);
  const total = await rows.count();

  const count = async gate => {
    await page.selectOption('#tests-gate', gate);
    await page.waitForFunction(
      g => document.getElementById('tests-gate').value === g, gate
    );
    return rows.count();
  };

  const never = await count('never');
  expect(never).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix td.pw-skipped').count()).toBe(0);
  await expect(page.locator('.table-note')).toContainText(`Showing the ${never} rows gated never`);

  const here = await count('skipped');
  expect(here).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix td.pw-never').count()).toBe(0);
  await expect(page.locator('.table-note'))
    .toContainText(`Showing the ${here} rows gated not in this variant`);

  const always = await count('always');
  expect(always).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix td.pw-unknown').count()).toBe(0);

  const maybe = await count('unknown');
  const runs = await count('runs');
  expect(runs + never + here + always + maybe, 'the five gates partition the rows')
    .toBe(total);

  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('gate=runs');

  await page.selectOption('#tests-gate', 'all');
  await expect.poll(() => rows.count()).toBe(total);
});

test('never and always maybe are role facts, not variant facts', async ({ page }) => {
  await page.goto('/?view=tests');
  await expect.poll(
    () => page.locator('table.tests-matrix td[data-cell]').count(), { timeout: 180000 }
  ).toBeGreaterThan(500);

  const verdict = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table.tests-matrix td[data-cell]')].map(td => ({
      role: td.closest('tr').querySelector('th.tests-axis').textContent.trim(),
      column: [...td.parentNode.querySelectorAll('td')].indexOf(td),
      gate: td.className.replace('pw-', ''),
    }));
    const groups = new Map();
    for (const row of rows) {
      // Same role, same column: the same test across that role's variants.
      const key = `${row.role}|${row.column}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.gate);
    }
    let neverGroups = 0;
    let brokenNever = 0;
    let brokenHere = 0;
    let alwaysGroups = 0;
    let brokenAlways = 0;
    let brokenOpen = 0;
    for (const gates of groups.values()) {
      if (gates.includes('never')) {
        neverGroups += 1;
        // Every sibling row of a never test must agree; a run anywhere refutes it.
        if (!gates.every(gate => gate === 'never')) brokenNever += 1;
      }
      // A row marked skipped must have a sibling that is not skipped.
      if (gates.includes('skipped') && gates.every(gate => gate === 'skipped')) brokenHere += 1;
      if (gates.includes('always')) {
        alwaysGroups += 1;
        // An always-maybe test must be open in every variant; one decided row refutes it.
        if (!gates.every(gate => gate === 'always')) brokenAlways += 1;
      }
      // A row marked unknown must have a sibling the repo does settle.
      if (gates.includes('unknown') && gates.every(gate => gate === 'unknown')) brokenOpen += 1;
    }
    return {
      groups: groups.size, neverGroups, brokenNever, brokenHere,
      alwaysGroups, brokenAlways, brokenOpen,
    };
  });

  expect(verdict.groups).toBeGreaterThan(100);
  expect(verdict.neverGroups, 'the tree has at least one test no variant runs')
    .toBeGreaterThan(0);
  expect(verdict.brokenNever, 'a never test runs in no variant').toBe(0);
  expect(verdict.brokenHere, 'a this-variant skip runs in some other variant').toBe(0);
  expect(verdict.alwaysGroups, 'the tree has tests no variant ever settles')
    .toBeGreaterThan(0);
  expect(verdict.brokenAlways, 'an always-maybe test is open in every variant').toBe(0);
  expect(verdict.brokenOpen, 'a this-variant maybe is settled in some other variant').toBe(0);
});

test('the variants switch splits each role line into its variants', async ({ page }) => {
  await page.goto('/?view=tests');
  const lines = page.locator('table.tests-matrix tbody tr');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => lines.count(), { timeout: 180000 }).toBeGreaterThan(50);

  const blindLines = await lines.count();
  const blindCells = await cells.count();
  const roles = await page.evaluate(() => new Set([...document.querySelectorAll(
    'table.tests-matrix tbody tr th.tests-axis:first-child'
  )].map(th => th.textContent.trim())).size);
  expect(blindLines, 'variant blind, a line is a role').toBe(roles);
  await expect(lines.first().locator('th.tests-axis').nth(1)).toHaveText('base');

  await page.locator('#btn-filter').click();
  await page.locator('#btn-variants').click();
  await expect.poll(() => lines.count(), { timeout: 60000 }).toBeGreaterThan(blindLines);

  const awareLines = await lines.count();
  expect(await cells.count(), 'every variant brings its own runs')
    .toBeGreaterThan(blindCells);
  const awareRoles = await page.evaluate(() => new Set([...document.querySelectorAll(
    'table.tests-matrix tbody tr th.tests-axis:first-child'
  )].map(th => th.textContent.trim())).size);
  expect(awareRoles, 'the same roles, only split').toBe(roles);
  expect(awareLines).toBeGreaterThan(awareRoles);

  await page.locator('#btn-variants').click();
  await expect.poll(() => lines.count()).toBe(blindLines);
});

test('the kind switch moves between the playwright and the cli suites', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(300);
  const playwrightRows = await rows.count();

  await page.locator('label[for="tests-kind-cli"]').click();
  await expect(page.locator('.table-note')).toContainText('CLI runs across');
  await expect(page.locator('.table-note')).toContainText(
    'CLI tests declare no <NAME>_SERVICE_ENABLED flags'
  );

  const cliRows = await rows.count();
  expect(cliRows, 'far fewer roles ship a CLI test').toBeLessThan(playwrightRows);
  expect(cliRows).toBeGreaterThan(0);
  // One script per role, so the CLI grid is a single column.
  await expect(page.locator('table.tests-matrix thead th')).toHaveText(
    ['role', 'variant', 'rank', '1']
  );

  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('kind=cli');

  await page.locator('label[for="tests-kind-playwright"]').click();
  await expect.poll(() => rows.count()).toBe(playwrightRows);
});

test('the note counts every run, whatever the grid shows', async ({ page }) => {
  await page.goto('/?view=tests');
  const cells = page.locator('table.tests-matrix td[data-cell]');
  await expect.poll(() => cells.count(), { timeout: 180000 }).toBeGreaterThan(300);

  await page.locator('#btn-filter').click();
  await page.locator('#btn-variants').click();
  await expect.poll(() => cells.count(), { timeout: 60000 }).toBeGreaterThan(1000);

  await expect(page.locator('.table-note')).toContainText('test runs across');
  await expect(page.locator('.table-note'))
    .toContainText('never run because a gate is off in every variant');
  await expect(page.locator('.table-note'))
    .toContainText('skipped only in their own variant');
  await expect(page.locator('.table-note'))
    .toContainText('never certain because no variant settles their gate');

  expect(await page.locator('table.tests-matrix td.pw-skipped').count()).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix th[data-role-name]').first().count(),
    'the role axis carries the hover card trigger').toBe(1);
});
