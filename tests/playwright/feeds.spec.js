const { test, expect } = require('@playwright/test');

const SHA = 'abc123def456';

const CATALOG = {
  root: 'infinito-nexus/core',
  span: { from: '2020-12-24T00:00:00Z', to: '2026-09-09T00:00:00Z' },
  tags: [],
  repos: [
    {
      remote: 'origin',
      full_name: 'infinito-nexus/core',
      refs: [
        { name: 'main', ref: 'main', tip: SHA, date: '2026-09-09T00:00:00Z' },
        { name: 'next', ref: 'next', tip: 'bb22', date: '2026-08-01T00:00:00Z' },
      ],
    },
    {
      remote: 'f1',
      full_name: 'someone/core',
      refs: [{ name: 'master', ref: 'f1/master', tip: 'ff22', date: '2026-03-01T00:00:00Z' }],
    },
  ],
};

const LOG = {
  main: [
    { sha: 'aaaa1111', parents: ['aaaa2222'], date: '2026-09-01T00:00:00Z', message: 'newest on main' },
    { sha: 'aaaa2222', parents: [], date: '2026-08-01T00:00:00Z', message: 'older on main' },
  ],
  next: [
    { sha: 'aaaa1111', parents: ['aaaa2222'], date: '2026-09-01T00:00:00Z', message: 'newest on main' },
    { sha: 'bbbb3333', parents: [], date: '2026-07-01T00:00:00Z', message: 'only on next' },
  ],
};

// Two pull requests per repository, one inside the default window and one from
// 2021, so the range has something to exclude.
function pulls(full) {
  return [
    {
      number: 7, title: `recent in ${full}`, state: 'open', merged_at: null,
      updated_at: '2026-08-20T00:00:00Z', html_url: `https://github.com/${full}/pull/7`,
      base: { repo: { full_name: full } },
    },
    {
      number: 1, title: `ancient in ${full}`, state: 'closed', merged_at: '2021-01-02T00:00:00Z',
      updated_at: '2021-01-02T00:00:00Z', html_url: `https://github.com/${full}/pull/1`,
      base: { repo: { full_name: full } },
    },
  ];
}

function runs(full) {
  return {
    workflow_runs: [
      {
        run_number: 42, name: 'test', status: 'completed', conclusion: 'success',
        created_at: '2026-08-25T00:00:00Z', html_url: `https://github.com/${full}/actions/runs/42`,
        repository: { full_name: full },
      },
      {
        run_number: 1, name: 'test', status: 'completed', conclusion: 'failure',
        created_at: '2021-02-02T00:00:00Z', html_url: `https://github.com/${full}/actions/runs/1`,
        repository: { full_name: full },
      },
    ],
  };
}

async function wire(page, calls) {
  await page.route('**/git/catalog', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG),
  }));
  await page.route('**/git/checkout*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sha: SHA, date: '2026-09-08T00:00:00Z', path: `/at/${SHA}/` }),
  }));
  await page.route('**/git/log*', route => {
    const ref = new URL(route.request().url()).searchParams.get('ref');
    calls.push(`log:${ref}`);
    route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(LOG[ref] || []),
    });
  });
  await page.route(`**/at/${SHA}/**`, route => {
    const url = new URL(route.request().url());
    route.continue({ url: `${url.origin}${url.pathname.replace(`/at/${SHA}/`, '/')}${url.search}` });
  });
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    const full = url.pathname.split('/').slice(2, 4).join('/');
    calls.push(url.pathname);
    const body = url.pathname.endsWith('/pulls') ? pulls(full)
      : url.pathname.endsWith('/actions/runs') ? runs(full)
        : [];
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
        'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900',
      },
      body: JSON.stringify(body),
    });
  });
}

async function boot(page, calls, query = '') {
  await wire(page, calls);
  await page.goto(`/${query}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 120000 }).toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
}

test('the commits tab merges the ticked refs and drops the duplicate', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main,next');
  await page.locator('label[for="view-commits"]').click();

  const rows = page.locator('table.commits-table tbody tr');
  await expect.poll(() => rows.count()).toBe(3);
  await expect(rows.first().locator('td').nth(4)).toHaveText('newest on main');
  await expect(rows.last().locator('td').nth(4), 'newest first').toHaveText('only on next');
  await expect(page.locator('.table-note'),
    'the duplicate is merged away, and the note says how many rows it came from')
    .toContainText('merged from 4 rows');
  expect(calls.filter(one => one.startsWith('log:')).sort()).toEqual(['log:main', 'log:next']);
});

test('a ref nobody ticked is never walked', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await page.locator('label[for="view-commits"]').click();
  await expect.poll(() => page.locator('table.commits-table tbody tr').count()).toBe(2);
  expect(calls.filter(one => one.startsWith('log:'))).toEqual(['log:main']);
});

test('the PR tab keeps what the range covers and links the rest out', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main,f1/master');
  await page.locator('label[for="view-pulls"]').click();

  const rows = page.locator('table.feed-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(2);
  await expect(page.locator('.table-note')).toContainText('2 of 4 in this window');
  await expect(rows.first().locator('td').nth(4)).toContainText('recent in');
  await expect(rows.first().locator('td a')).toHaveAttribute('href', /\/pull\/7$/);

  expect(calls.filter(one => one.endsWith('/pulls')).sort(),
    'one call per ticked repository, not per ref').toEqual([
    '/repos/infinito-nexus/core/pulls', '/repos/someone/core/pulls',
  ]);
});

test('the actions tab reads the runs and marks the conclusion', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await page.locator('label[for="view-actions"]').click();

  const rows = page.locator('table.feed-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(1);
  await expect(rows.first().locator('td.feed-mark')).toHaveText('success');
  await expect(rows.first().locator('td.feed-mark')).toHaveClass(/feed-success/);
  expect(calls.filter(one => one.endsWith('/actions/runs')))
    .toEqual(['/repos/infinito-nexus/core/actions/runs']);
});

test('leaving and returning to a feed spends no second request', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=main');
  await page.locator('label[for="view-pulls"]').click();
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 })
    .toBe(1);
  const spent = calls.filter(one => one.endsWith('/pulls')).length;
  expect(spent).toBe(1);

  await page.locator('label[for="view-actions"]').click();
  await expect.poll(() => page.locator('table.feed-table tbody tr').count()).toBe(1);
  await page.locator('label[for="view-pulls"]').click();
  await expect.poll(() => page.locator('table.feed-table tbody tr').count()).toBe(1);

  expect(calls.filter(one => one.endsWith('/pulls')).length,
    'the cache answers the second visit').toBe(spent);
});

test('a feed with nothing ticked asks GitHub nothing at all', async ({ page }) => {
  const calls = [];
  await boot(page, calls, '?refs=none/at-all');
  await page.locator('label[for="view-pulls"]').click();
  await expect(page.locator('.table-note')).toContainText('No source ticked');
  expect(calls.filter(one => one.endsWith('/pulls'))).toEqual([]);
});
