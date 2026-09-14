const { test, expect } = require('@playwright/test');
const { boot } = require('./support/feeds');

const since = stamp => `created=${encodeURIComponent(`>=${stamp}`)}`;
const asked = urls => urls.filter(url => url.includes('/actions/runs?'));

async function openActions(page, calls, query, options) {
  await boot(page, calls, query, options);
  await page.locator('label[for="view-actions"]').click();
}

test('clicking a run in the actions tab opens the playwright tests held against it', async ({ page }) => {
  const calls = [];
  await openActions(page, calls, '?refs=main,f1/master');
  const rows = page.locator('table.feed-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(2);
  const fork = rows.filter({ hasText: 'someone/core' });
  await expect(fork).toHaveAttribute('title', "Show this run's tests");

  await fork.locator('td').first().click();
  await expect(page.locator('#btn-tests')).toHaveText('Tests · Playwright');
  await expect(page.locator('.tests-run select'), 'a fork run keeps its repository')
    .toHaveValue('someone/core@901', { timeout: 120000 });
  await expect.poll(() => page.evaluate(() => new URLSearchParams(window.location.search).get('run')))
    .toBe('someone/core@901');
  expect(calls).toContain('/repos/someone/core/actions/runs/901/artifacts');
});

test('every minute the actions tab asks only for what changed since its last answer', async ({ page }) => {
  await page.clock.install();
  const calls = [];
  const urls = [];
  await openActions(page, calls, '?refs=main,f1/master', { urls });
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 }).toBe(2);
  const loader = page.locator('#view-loader');
  await expect(loader).toHaveAttribute('data-state', 'waiting');
  await expect(loader).toHaveAttribute('aria-label', /^Next refresh in \d+ seconds? · /);
  await expect(loader.locator('path.loader-fill'), 'a slice shows the share already waited').toHaveCount(1);
  expect(asked(urls), 'one full request per ticked repository').toHaveLength(2);

  await page.clock.fastForward('01:01');
  await expect.poll(() => asked(urls).length).toBe(4);
  expect(asked(urls).slice(2).sort(), 'nothing is still running, so the newest run is where it starts')
    .toEqual([
      `/repos/infinito-nexus/core/actions/runs?per_page=100&${since('2026-08-25T00:00:00Z')}`,
      `/repos/someone/core/actions/runs?per_page=100&${since('2026-08-25T00:00:00Z')}`,
    ]);
  await expect(page.locator('table.feed-table tbody tr')).toHaveCount(2);

  await page.locator('label[for="view-commits"]').click();
  await expect(loader, 'the countdown belongs to the actions tab only').toHaveAttribute('data-state', 'idle');
  await page.clock.fastForward('02:00');
  expect(asked(urls), 'another tab spends nothing').toHaveLength(4);
});

test('a run still going at the last answer is asked for again and shows how it ended', async ({ page }) => {
  await page.clock.install();
  const calls = [];
  const urls = [];
  const run = (id, created, status, conclusion) => ({
    id, run_number: id, name: 'deploy', status, conclusion, created_at: created,
    html_url: `https://github.com/infinito-nexus/core/actions/runs/${id}`,
    repository: { full_name: 'infinito-nexus/core' },
  });
  const runs = (full, url) => ({
    workflow_runs: url.searchParams.has('created')
      ? [run(7, '2026-08-20T00:00:00Z', 'completed', 'success')]
      : [run(7, '2026-08-20T00:00:00Z', 'in_progress', null), run(8, '2026-08-24T00:00:00Z', 'completed', 'failure')],
  });
  await openActions(page, calls, '?refs=main', { urls, runs });
  const marks = page.locator('table.feed-table tbody td.feed-mark');
  await expect(marks).toHaveText(['failure', 'in_progress'], { timeout: 30000 });

  await page.clock.fastForward('01:01');
  await expect(marks, 'the finished run is updated, the one not asked for again is kept')
    .toHaveText(['failure', 'success']);
  expect(asked(urls).pop(), 'it starts at the oldest run that was still going')
    .toBe(`/repos/infinito-nexus/core/actions/runs?per_page=100&${since('2026-08-20T00:00:00Z')}`);
});

test('filters narrow the runs and stay in the URL; a run after the mirror still shows', async ({ page }) => {
  const calls = [];
  const run = (id, fields) => ({
    id, run_number: id, status: 'completed', repository: { full_name: 'infinito-nexus/core' },
    html_url: `https://github.com/infinito-nexus/core/actions/runs/${id}`, ...fields,
  });
  const runs = () => ({
    workflow_runs: [
      run(1, { name: 'Push', event: 'push', head_branch: 'main', conclusion: 'success', created_at: '2026-08-20T00:00:00Z' }),
      run(2, { name: 'Pull Request', event: 'pull_request', head_branch: 'feature/x', conclusion: 'failure', created_at: '2026-08-21T00:00:00Z' }),
      run(3, { name: 'Push', event: 'push', head_branch: 'main', conclusion: 'failure', created_at: '2026-09-11T00:00:00Z' }),
    ],
  });
  await openActions(page, calls, '?refs=main', { runs });
  const rows = page.locator('table.feed-table tbody tr');
  await expect(rows, 'the window ends at the newest mirrored commit, the feed at now').toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('select[data-filter="result"] option')).toHaveText(['all', 'failure (2)', 'success (1)']);

  await page.locator('select[data-filter="result"]').selectOption('failure');
  await page.locator('select[data-filter="workflow"]').selectOption('Push');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('td').nth(5)).toHaveText('#3');
  await expect(page.locator('.table-note')).toContainText('1 is left after the filters.');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('result=failure');

  await page.reload();
  await expect(rows, 'a reload keeps the filters').toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('select[data-filter="workflow"]')).toHaveValue('Push');

  await page.locator('.feed-filters button').click();
  await expect(rows).toHaveCount(3);
  await page.locator('.feed-search').fill('feature/x');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('td').nth(5)).toHaveText('#2');
});

test.describe('read in UTC', () => {
  test.use({ timezoneId: 'UTC' });

  test('each run shows when it started, when it ended and how long it took', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-21T09:05:30Z') });
    const calls = [];
    const run = (id, fields) => ({
      id, run_number: id, name: 'deploy', repository: { full_name: 'infinito-nexus/core' },
      html_url: `https://github.com/infinito-nexus/core/actions/runs/${id}`, ...fields,
    });
    const runs = () => ({
      workflow_runs: [
        run(1, {
          status: 'completed', conclusion: 'success', created_at: '2026-08-20T09:59:00Z',
          run_started_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T11:02:03Z',
        }),
        run(2, {
          status: 'in_progress', conclusion: null, created_at: '2026-08-21T09:00:00Z',
          run_started_at: '2026-08-21T09:00:00Z', updated_at: '2026-08-21T09:01:00Z',
        }),
      ],
    });
    await openActions(page, calls, '?refs=main&refresh=0', { runs });
    await expect(page.locator('table.feed-table thead th')).toHaveText(
      ['Started', 'Ended', 'Duration', 'Repository', 'Result', 'Run', 'Workflow', 'Open'], { timeout: 30000 }
    );
    const cells = row => page.locator('table.feed-table tbody tr').nth(row).locator('td');
    await expect(cells(0).nth(0)).toHaveText('2026-08-21 09:00');
    await expect(cells(0).nth(1), 'a run still going has no end yet').toHaveText('running');
    await expect(cells(0).nth(2), 'and has taken this long so far; the clock keeps going').toHaveText(/^5:\d\d$/);
    await expect(cells(1).nth(0), 'the start is when it began, not when it was queued').toHaveText('2026-08-20 10:00');
    await expect(cells(1).nth(1)).toHaveText('2026-08-20 11:02');
    await expect(cells(1).nth(2)).toHaveText('1:02:03');
    await expect(page.locator('.table-note')).toContainText('The longest run shown took 1:02:03 (#1).');
  });
});

test('a list the cache answers is caught up with what changed at once', async ({ page }) => {
  const calls = [];
  const urls = [];
  await openActions(page, calls, '?refs=main&refresh=0', { urls });
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 }).toBe(1);
  expect(asked(urls)).toHaveLength(1);

  await page.locator('label[for="view-commits"]').click();
  await page.locator('label[for="view-actions"]').click();
  await expect.poll(() => asked(urls).length, 'the cached list is shown, then asked what changed').toBe(2);
  expect(asked(urls)[1]).toContain(since('2026-08-25T00:00:00Z'));
});

test('the loader turns while the tab waits for its answer, and refresh=0 stops the clock', async ({ page }) => {
  const calls = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await boot(page, calls, '?refs=main&refresh=0');
  await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/actions\/runs\?/, route => held.then(() => route.fallback()));
  await page.locator('label[for="view-actions"]').click();
  const loader = page.locator('#view-loader');
  await expect(loader).toHaveAttribute('data-state', 'loading');
  await expect(loader.locator('svg.loader-spin')).toHaveCount(1);
  release();
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 }).toBe(1);
  await expect(loader, 'with refreshing off the ring rests').toHaveAttribute('data-state', 'idle');
  await expect(loader.locator('.loader-fill')).toHaveCount(0);
});

test('hovering the loader lists what loads and how each load went', async ({ page }) => {
  const calls = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await boot(page, calls, '?refs=main&refresh=0');
  await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/actions\/runs\?/, route => held.then(() => route.fallback()));
  await page.locator('label[for="view-actions"]').click();

  await page.locator('#view-loader').hover();
  const overview = page.locator('#loader-overview');
  await expect(overview).toBeVisible();
  await expect(overview.locator('.loader-overview-title')).toHaveText('Loading · 2 running');
  await expect(overview.locator('.loader-task-loading', { hasText: 'Drawing Actions' })).toHaveCount(1);
  await expect(overview.locator('.loader-task-loading',
    { hasText: 'GitHub /repos/infinito-nexus/core/actions/runs?per_page=100' })).toHaveCount(1);
  await expect(overview.locator('.loader-task-done', { hasText: 'Reading the roles and their meta' }),
    'what already finished stays listed with its outcome').toHaveCount(1);

  release();
  await expect(overview.locator('.loader-task-loading'), 'the open overview follows the loads').toHaveCount(0);
  await expect(overview.locator('.loader-task-done', { hasText: 'Drawing Actions' })).toHaveCount(1);
  await page.mouse.move(2, 2);
  await expect(overview).toBeHidden();
});

test('right-clicking the loader offers the reloads of the tab on screen', async ({ page }) => {
  const calls = [];
  const urls = [];
  await openActions(page, calls, '?refs=main', { urls });
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 30000 }).toBe(1);
  const loader = page.locator('#view-loader');
  const menu = page.locator('.loader-menu.show');

  await loader.click({ button: 'right' });
  await expect(menu.locator('button')).toHaveText([
    'Only what changed, now', 'Every run, now',
    'every 30 seconds', 'every 1 minute', 'every 5 minutes', 'never',
    'Forget the cached GitHub answers', 'Reload the page',
  ]);
  await expect(menu.locator('button.active'), 'the interval in force is marked').toHaveText('every 1 minute');
  await menu.locator('button', { hasText: 'every 30 seconds' }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new URLSearchParams(window.location.search).get('refresh')))
    .toBe('30');

  await loader.click({ button: 'right' });
  await menu.locator('button', { hasText: 'Only what changed, now' }).click();
  await expect.poll(() => asked(urls).length).toBe(2);
  expect(asked(urls)[1]).toContain(since('2026-08-25T00:00:00Z'));

  await page.locator('label[for="view-commits"]').click();
  await loader.focus();
  await page.keyboard.press('Enter');
  await expect(menu.locator('button'), 'a tab without a clock offers to draw itself again').toHaveText([
    'This tab, now', 'Forget the cached GitHub answers', 'Reload the page',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(loader).toBeFocused();
});
