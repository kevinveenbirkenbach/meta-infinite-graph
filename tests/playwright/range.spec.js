const { test, expect } = require('@playwright/test');

const SHA = 'abc123def456';

const CATALOG = {
  root: 'infinito-nexus/core',
  span: { from: '2020-12-24T14:27:31+01:00', to: '2026-09-09T14:01:38+02:00' },
  tags: [{ name: 'v13.0.0', sha: SHA, date: '2026-08-01T00:00:00Z' }],
  repos: [
    {
      remote: 'origin',
      full_name: 'infinito-nexus/core',
      refs: [
        { name: 'main', ref: 'main', tip: SHA, date: '2026-09-09T14:01:38+02:00' },
        { name: 'dependabot/x', ref: 'dependabot/x', tip: 'dd11', date: '2026-05-01T00:00:00Z' },
      ],
    },
    {
      remote: 'f1',
      full_name: 'someone/core',
      refs: [{ name: 'master', ref: 'f1/master', tip: 'ff22', date: '2026-03-01T00:00:00Z' }],
    },
  ],
};

// Serving the worktree path from the same roles tree is what proves the
// frontend reads through it instead of /roles.
async function mirror(page, calls) {
  await page.route('**/git/catalog', route => {
    calls.push('catalog');
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) });
  });
  await page.route('**/git/checkout*', route => {
    calls.push(new URL(route.request().url()).search);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha: SHA, date: '2025-09-06T10:46:39+02:00', path: `/at/${SHA}/` }),
    });
  });
  await page.route(`**/at/${SHA}/**`, route => {
    const url = new URL(route.request().url());
    const served = url.pathname.replace(`/at/${SHA}/meta/`, '/infinito_meta/').replace(`/at/${SHA}/`, '/');
    route.continue({ url: `${url.origin}${served}${url.search}` });
  });
}

test('without the mirror the bar stays as it was', async ({ page }) => {
  await page.route('**/git/catalog', route => route.fulfill({ status: 404, body: '{}' }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 60000 }).toBe(true);
  await expect(page.locator('#git-range')).toBeHidden();
  expect(await page.evaluate(() => window.gitRange.catalog)).toBe(null);
});

test('the bar spans the whole history and starts twelve months back', async ({ page }) => {
  const calls = [];
  await mirror(page, calls);
  await page.goto('/');
  await expect(page.locator('#git-range')).toBeVisible();

  const range = await page.evaluate(() => ({
    from: new Date(window.gitRange.from).toISOString().slice(0, 10),
    until: new Date(window.gitRange.until).toISOString().slice(0, 10),
    refs: window.gitRange.refs,
    span: [
      new Date(window.gitRange.span.from).toISOString().slice(0, 4),
      new Date(window.gitRange.span.to).toISOString().slice(0, 4),
    ],
  }));
  expect(range.span, 'the axis runs from the first commit to the last').toEqual(['2020', '2026']);
  expect(range.from, 'twelve months back from the newest commit').toBe('2025-09-09');
  expect(range.until).toBe('2026-09-09');
  expect(range.refs, 'only the root default branch is pulled by default').toEqual(['main']);

  expect(calls.filter(one => one.startsWith('?')).length,
    'the right handle is resolved to a commit before the roles tree is read').toBe(1);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 60000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__mig.dataLoader.basePath)).toBe(`/at/${SHA}/roles`);
  expect(await page.evaluate(() => window.__mig.dataLoader.metaPath)).toBe(`/at/${SHA}/meta`);
});

test('the far left means every commit, not a date', async ({ page }) => {
  await mirror(page, []);
  await page.goto('/');
  await expect(page.locator('#git-range')).toBeVisible();

  expect(await page.evaluate(() => window.gitRange.since()),
    'a default range asks for a since').not.toBe('');
  expect(await page.evaluate(() => {
    window.gitRange.from = window.gitRange.span.from;
    return window.gitRange.since();
  }), 'the far left drops the since so git walks the whole history').toBe('');
});

test('the sources menu lists every fork and branch as a box', async ({ page }) => {
  await mirror(page, []);
  await page.goto('/');
  await expect(page.locator('#git-range')).toBeVisible();

  await page.locator('#btn-sources').click();
  const menu = page.locator('#range-sources');
  await expect(menu.locator('.range-repo-name')).toHaveText([
    'infinito-nexus/core', 'someone/core',
  ]);
  await expect(menu.locator('input[type="checkbox"]')).toHaveCount(3);
  expect(await menu.locator('input:checked').count(),
    'main only, so a fresh visit does not pull every branch of every fork').toBe(1);
});

test('ticking a fork branch never moves the tables onto that fork', async ({ page }) => {
  const asked = [];
  await mirror(page, asked);
  // f1/master sorts before the root in the menu, so the first ticked box is a
  // fork's.
  await page.goto('/?refs=f1/master,main');
  await expect(page.locator('#git-range')).toBeVisible();

  const checkout = asked.find(one => one.startsWith('?'));
  expect(decodeURIComponent(checkout), 'the root ref, not the fork').toContain('ref=main');
  expect(decodeURIComponent(checkout)).not.toContain('f1/master');
  expect(await page.evaluate(() => window.gitRange.treeRef())).toBe('main');
});

test('a date without the current schema greys the views that need it',
  async ({ page }) => {
    await mirror(page, []);
    // core carried no top level meta/ before 2026, which is most of its history.
    await page.route(`**/at/${SHA}/meta/categories.yml`, route =>
      route.fulfill({ status: 404, body: '' }));
    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 60000 })
      .toBe(true);

    const warning = page.locator('#range-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('fehlt');
    expect(await warning.getAttribute('title'), 'the tooltip names the file')
      .toContain('meta/categories.yml');

    for (const view of ['graph', 'bond', 'matrix', 'tests']) {
      expect(await page.locator(`#view-${view}`).isDisabled(), `${view} is greyed`).toBe(true);
      expect(await page.locator(`label[for="view-${view}"]`).getAttribute('title'))
        .toContain('does not exist at the chosen date');
    }
    for (const view of ['forks', 'commits', 'pulls', 'actions']) {
      expect(await page.locator(`#view-${view}`).isDisabled(),
        `${view} needs no roles tree, so it stays usable`).toBe(false);
    }
    expect(await page.evaluate(() => document.querySelector('input[name="view"]:checked').value),
      'and the greyed default gives way to one that works').toBe('commits');
  });

test('a moved handle travels in the URL', async ({ page }) => {
  await mirror(page, []);
  await page.goto('/?until=2024-06-01T00:00:00.000Z');
  await expect(page.locator('#git-range')).toBeVisible();
  expect(await page.evaluate(() => new Date(window.gitRange.until).toISOString().slice(0, 10)))
    .toBe('2024-06-01');
});
