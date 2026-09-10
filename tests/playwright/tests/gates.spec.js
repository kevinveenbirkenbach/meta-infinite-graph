const { test, expect } = require('@playwright/test');

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
