const { test, expect } = require('@playwright/test');
const { boot: bootMirror } = require('./support/mirror');

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

async function boot(page, calls, query = '') {
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
  await bootMirror(page, calls, query);
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
  expect(await rows.first().locator('td.feed-mark').evaluate(cell => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--bs-success)';
    const success = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(cell).color === success;
  }), 'the table style must not paint over the conclusion').toBe(true);
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
