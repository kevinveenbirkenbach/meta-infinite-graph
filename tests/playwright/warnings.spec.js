const { test, expect } = require('@playwright/test');
const { boot } = require('./support/mirror');

const ROOT = 'infinito-nexus/core';
const FORK = 'someone/core';

const RUNS = {
  [`${ROOT}|main`]: {
    id: 900, run_number: 42, name: 'test', path: '.github/workflows/entry-push-latest.yml',
    status: 'completed', conclusion: 'failure',
    head_branch: 'main', head_sha: 'aaaa1111', created_at: '2026-09-01T00:00:00Z',
    html_url: `https://github.com/${ROOT}/actions/runs/900`, repository: { full_name: ROOT },
  },
  [`${FORK}|master`]: {
    id: 901, run_number: 43, name: 'test', path: '.github/workflows/entry-push-latest.yml',
    status: 'completed', conclusion: 'success',
    head_branch: 'master', head_sha: 'ffff2222', created_at: '2026-08-01T00:00:00Z',
    html_url: `https://github.com/${FORK}/actions/runs/901`, repository: { full_name: FORK },
  },
  [`${ROOT}|picked`]: {
    id: 800, run_number: 7, name: 'test', path: '.github/workflows/entry-push-latest.yml',
    status: 'completed', conclusion: 'success',
    head_branch: 'main', head_sha: 'bbbb3333', created_at: '2026-07-01T00:00:00Z',
    html_url: `https://github.com/${ROOT}/actions/runs/800`, repository: { full_name: ROOT },
  },
};

const job = (name, conclusion, repo, check) => ({
  name,
  conclusion,
  html_url: `https://github.com/j/${check}`,
  check_run_url: `https://api.github.com/repos/${repo}/check-runs/${check}`,
});

const JOBS = {
  900: [
    job('🧪 Test', 'failure', ROOT, 11),
    job('🔨 Build', 'success', ROOT, 12),
  ],
  901: [
    job('🧪 Test', 'success', FORK, 21),
  ],
  800: [
    job('🧪 Test', 'success', ROOT, 31),
  ],
};

const note = (level, path, line, title, message) => ({
  annotation_level: level, path, start_line: line, title, message,
});

const ANNOTATIONS = {
  11: [
    note('failure', 'tests/unit/python/utils/test_distros.py', 12, 'assert', 'make test failed'),
    note('warning', 'roles/web-app-nextcloud/tasks/main.yml', 3, 'deprecated', 'deprecated flag'),
  ],
  12: [note('notice', '', 0, 'cache', 'cache miss')],
  21: [note('warning', 'scripts/build.sh', 9, 'slow', 'slow step')],
  31: [note('warning', 'utils/annotations/summarize.py', 1, 'picked', 'from the picked run')],
};

async function wire(page, asked) {
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    asked.push(path + url.search);
    const full = path.split('/').slice(2, 4).join('/');
    let body = [];
    if (path.endsWith('/actions/runs')) {
      const branch = url.searchParams.get('branch');
      const run = RUNS[`${full}|${branch}`];
      body = { workflow_runs: run ? [run] : Object.values(RUNS).filter(one => one.repository.full_name === full) };
    } else if (path.endsWith('/jobs')) {
      const jobs = JOBS[path.split('/runs/')[1].split('/')[0]] || [];
      body = { total_count: jobs.length, jobs };
    } else if (path.endsWith('/annotations')) {
      body = ANNOTATIONS[path.split('/check-runs/')[1].split('/')[0]] || [];
    }
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

const rows = page => page.locator('table.warn-table tbody tr');

test('the warnings tab gathers every job of the newest run of each ticked branch', async ({ page }) => {
  const asked = [];
  await wire(page, asked);
  await boot(page, [], '?refs=main,f1/master&view=warnings');

  await expect.poll(() => rows(page).count(), { timeout: 60000 }).toBe(4);
  await expect(page.locator('.table-note')).toContainText('Across 2 runs');
  await expect(page.locator('.table-note')).toContainText('1 errors, 2 warnings, 1 notices');

  const levels = await page.locator('table.warn-table tbody td:first-child').allInnerTexts();
  expect(levels.map(text => text.trim()), 'the worst comes first')
    .toEqual(['error', 'warning', 'warning', 'notice']);

  const first = rows(page).first();
  await expect(first).toContainText('make test failed');
  await expect(first.locator('a', { hasText: '🧪 Test' })).toHaveAttribute('href', 'https://github.com/j/11');
  await expect(first.locator('a', { hasText: 'tests/unit/python/utils/test_distros.py:12' }))
    .toHaveAttribute('href', `https://github.com/${ROOT}/blob/aaaa1111/tests/unit/python/utils/test_distros.py#L12`);

  await expect(page.locator('.warn-runs li').first()).toContainText(`${ROOT} #42: 2 of 2 jobs read`);

  const checks = asked.filter(path => path.includes('/check-runs/'));
  expect(checks[0], 'the job that is not green is asked for first').toContain('/check-runs/11/');
  expect(asked.filter(path => path.includes('per_page=1&branch=')).length, 'one query per ticked branch').toBe(2);
});

test('the filters narrow the warnings and travel in the URL', async ({ page }) => {
  await wire(page, []);
  await boot(page, [], '?refs=main,f1/master&view=warnings');
  await expect.poll(() => rows(page).count(), { timeout: 60000 }).toBe(4);

  await page.locator('select[data-filter="level"]').selectOption('warning');
  await expect.poll(() => rows(page).count()).toBe(2);
  await expect(page.locator('.table-note')).toContainText('2 are left after the filters');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('warnlevel=warning');

  await page.locator('.feed-search').fill('slow');
  await expect.poll(() => rows(page).count()).toBe(1);
  await expect(rows(page).first()).toContainText('slow step');

  await page.locator('button', { hasText: 'Clear' }).click();
  await expect.poll(() => rows(page).count()).toBe(4);
});

test('a picked run is read beside the newest ones, and a run row jumps into both views', async ({ page }) => {
  await wire(page, []);
  await boot(page, [], '?refs=main&view=actions');
  await expect.poll(() => page.locator('table.feed-table tbody tr').count(), { timeout: 60000 }).toBeGreaterThan(0);

  const run = page.locator('table.feed-table tbody tr', { hasText: '#7' });
  await run.locator('button', { hasText: '⚠️' }).click();
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('view=warnings');
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('run=800');
  await expect.poll(() => rows(page).count(), { timeout: 60000 }).toBe(4);
  await expect(page.locator('table.warn-table tbody tr', { hasText: 'from the picked run' }),
    'the picked run is read beside the newest of the branch').toHaveCount(1);

  await page.locator('label[for="view-actions"]').click();
  await page.locator('table.feed-table tbody tr', { hasText: '#7' }).locator('button', { hasText: '🧪' }).click();
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('view=unit');
  await expect(page.locator('#btn-tests')).toHaveText('Tests · Unit');
});

test('a picked run marks the files its jobs reported on', async ({ page }) => {
  await wire(page, []);
  await boot(page, [], '?refs=main&run=900&view=unit');

  const rows = page.locator('table.code-table tbody tr.code-row');
  await expect.poll(() => rows.count(), { timeout: 180000 }).toBeGreaterThan(100);
  await expect(page.locator('table.code-table thead th').last(), 'a held run adds its own column')
    .toHaveText('run');

  const marked = rows.filter({ has: page.locator('td.code-mark') });
  await expect.poll(() => marked.count(), { timeout: 60000 }).toBe(1);
  await expect(marked.first()).toContainText('test_distros.py');
  await expect(marked.first().locator('td.code-mark')).toHaveText('error 1');
  await expect(page.locator('.table-note')).toContainText('Run #42 reported on 1');
});
