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

test('the CI sort follows meta/ci-order.json and never re-derives it', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(500);

  const plan = await page.evaluate(() => fetch('/meta/ci-order.json').then(r => r.json()));
  const rank = new Map(plan.rows.map(row => [`${row.role}#${row.variant}`, row.id]));

  await page.locator('#btn-filter').click();
  await page.selectOption('#tests-sort', 'ci');
  await expect(page.locator('.table-note')).toContainText('CI order from meta/ci-order.json');

  const seen = await page.evaluate(() => [...document.querySelectorAll(
    'table.tests-matrix tbody tr'
  )].map(tr => {
    const cells = tr.querySelectorAll('td');
    return `${cells[0].textContent.trim()}#${cells[1].textContent.trim()}`;
  }));

  const ranked = seen.map(key => rank.get(key)).filter(id => id !== undefined);
  expect(ranked.length, 'the plan covers most of the matrix').toBeGreaterThan(100);
  const sorted = [...ranked].sort((a, b) => a - b);
  expect(ranked, 'planned rows appear in plan order').toEqual(sorted);

  const firstUnplanned = seen.findIndex(key => !rank.has(key));
  const lastPlanned = seen.reduce((last, key, i) => (rank.has(key) ? i : last), -1);
  if (firstUnplanned !== -1) {
    expect(firstUnplanned, 'every planned row comes before every unplanned one')
      .toBeGreaterThan(lastPlanned);
  }
});

test('the chosen sort survives a reload through the URL', async ({ page }) => {
  await page.goto('/?view=tests&sort=ci');
  await expect.poll(
    () => page.locator('table.tests-matrix tbody tr').count(), { timeout: 180000 }
  ).toBeGreaterThan(500);
  await page.locator('#btn-filter').click();
  await expect(page.locator('#tests-sort')).toHaveValue('ci');

  // 'name' is the registered fallback, so it is the value the URL leaves out.
  await page.selectOption('#tests-sort', 'name');
  await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain('sort=');

  await page.selectOption('#tests-sort', 'ci');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('sort=ci');
});

test('the gate filter partitions the rows across its five marks', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(500);
  const total = await rows.count();

  await page.locator('#btn-filter').click();
  const count = async gate => {
    await page.selectOption('#tests-gate', gate);
    await page.waitForFunction(
      g => document.getElementById('tests-gate').value === g, gate
    );
    return rows.count();
  };

  const never = await count('never');
  expect(never).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix tr.pw-skipped').count()).toBe(0);
  await expect(page.locator('.table-note')).toContainText(`Showing the ${never} rows gated never`);

  const here = await count('skipped');
  expect(here).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix tr.pw-never').count()).toBe(0);
  await expect(page.locator('.table-note'))
    .toContainText(`Showing the ${here} rows gated not in this variant`);

  const always = await count('always');
  expect(always).toBeGreaterThan(0);
  expect(await page.locator('table.tests-matrix tr.pw-unknown').count()).toBe(0);

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
    () => page.locator('table.tests-matrix tbody tr').count(), { timeout: 180000 }
  ).toBeGreaterThan(500);

  const verdict = await page.evaluate(() => {
    const cells = tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
    const rows = [...document.querySelectorAll('table.tests-matrix tbody tr')].map(tr => {
      const c = cells(tr);
      return { role: c[0], test: c[3], gate: tr.className.replace('pw-', '') };
    });
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.role}|${row.test}`;
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

test('the kind switch moves between the playwright and the cli suites', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(500);
  const playwrightRows = await rows.count();

  await page.locator('label[for="tests-kind-cli"]').click();
  await expect(page.locator('table.tests-matrix thead th')).toHaveText(
    ['role', 'variant', 'chunk', 'script', 'runs', 'timeout', 'env flags', 'shared harness']
  );
  await expect(page.locator('.table-note')).toContainText('CLI runs across');
  await expect(page.locator('.table-note')).toContainText(
    'CLI tests declare no <NAME>_SERVICE_ENABLED flags'
  );

  const cliRows = await rows.count();
  expect(cliRows, 'far fewer roles ship a CLI test').toBeLessThan(playwrightRows);
  expect(cliRows).toBeGreaterThan(0);
  await expect(rows.first().locator('td').nth(3)).toHaveText('files/test/test.sh');

  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('kind=cli');

  await page.locator('label[for="tests-kind-playwright"]').click();
  await expect.poll(() => rows.count()).toBe(playwrightRows);
});

test('the playwright view builds a row per role, variant and test', async ({ page }) => {
  await page.goto('/?view=tests');
  const rows = page.locator('table.tests-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(500);

  await expect(page.locator('.table-note')).toContainText('test runs across');
  await expect(page.locator('.table-note'))
    .toContainText('never run because a gate is off in every variant');
  await expect(page.locator('.table-note'))
    .toContainText('skipped only in their own variant');
  await expect(page.locator('.table-note'))
    .toContainText('never certain because no variant settles their gate');

  const head = page.locator('table.tests-matrix thead th');
  await expect(head).toHaveText(
    ['role', 'variant', 'chunk', 'test', 'runs', 'skip gates', 'branch gates', 'why']
  );
  expect(await page.locator('table.tests-matrix tr.pw-skipped').count()).toBeGreaterThan(0);
  expect(await rows.first().locator('td[data-role-name]').count(),
    'the role cell carries the hover card trigger').toBe(1);
});
