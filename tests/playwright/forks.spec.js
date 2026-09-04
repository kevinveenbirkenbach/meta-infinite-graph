const { test, expect } = require('@playwright/test');

const ROOT = {
  full_name: 'infinito-nexus/core',
  html_url: 'https://github.com/infinito-nexus/core',
  default_branch: 'main',
  forks_count: 2,
  stargazers_count: 17,
  pushed_at: '2026-09-03T08:00:00Z',
};

const FORKS = [
  {
    full_name: 'someone/core',
    html_url: 'https://github.com/someone/core',
    default_branch: 'main',
    forks_count: 0,
    stargazers_count: 0,
    pushed_at: '2026-08-01T00:00:00Z',
  },
  {
    full_name: 'other/core-fork',
    html_url: 'https://github.com/other/core-fork',
    default_branch: 'master',
    forks_count: 1,
    stargazers_count: 3,
    pushed_at: '2026-07-02T00:00:00Z',
  },
];

const HOSTILE ='<img src=x onerror="window.__pwned=1">';

function stub(page, counter) {
  return page.route('https://api.github.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    counter.push(path);
    const body = (() => {
      if (path === '/repos/infinito-nexus/core') return ROOT;
      if (path === '/repos/infinito-nexus/core/forks') return FORKS;
      if (path.endsWith('/branches')) return [{ name: 'main' }, { name: HOSTILE }];
      if (path.endsWith('/tags')) return [{ name: 'v13.0.0' }, { name: 'v11.6.0' }];
      return [];
    })();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': String(60 - counter.length),
        'x-ratelimit-reset': '1788435440',
      },
      body: JSON.stringify(body),
    });
  });
}

async function openForks(page, counter) {
  await stub(page, counter);
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();
}

test('the fork tree shows the root and its forks', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);

  const nodes = page.locator('.fork-tree .fork-name');
  await expect.poll(() => nodes.count()).toBe(3);
  await expect(nodes.nth(0)).toHaveText('infinito-nexus/core');
  await expect(nodes.nth(0)).toHaveClass(/root/);
  await expect(nodes.nth(1)).toHaveText('someone/core');
  await expect(page.locator('.table-note')).toContainText('2 direct forks');
  await expect(page.locator('.table-note')).toContainText('requests left this hour');

  expect(calls).toEqual(['/repos/infinito-nexus/core', '/repos/infinito-nexus/core/forks']);
});

test('branches and tags load only when a node is opened', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  expect(calls.length).toBe(2);

  await page.locator('.fork-toggle').first().click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls.slice(2).sort()).toEqual([
    '/repos/infinito-nexus/core/branches',
    '/repos/infinito-nexus/core/tags',
  ]);
  expect(calls, 'releases are empty on this network and cost a request').not.toContain(
    '/repos/infinito-nexus/core/releases'
  );

  const body = page.locator('.fork-body').first();
  await expect(body).toContainText('Branches (2)');
  await expect(body).toContainText('Versions (2)');
  await expect(body).toContainText('v13.0.0');
});

test('a hostile branch name is rendered as text, not as markup', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await page.locator('.fork-toggle').first().click();
  await expect.poll(() => calls.length).toBe(4);

  const body = page.locator('.fork-body').first();
  await expect(body).toContainText(HOSTILE);
  expect(await body.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('the cache spares the quota on a second visit', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  expect(calls.length).toBe(2);

  await page.locator('label[for="view-graph"]').click();
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  expect(calls.length, 'a reload must not spend a single request').toBe(2);
});

test('an exhausted quota says so instead of failing silently', async ({ page }) => {
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: 403,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1788435440',
    },
    body: JSON.stringify({ message: 'API rate limit exceeded' }),
  }));
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();

  await expect(page.locator('.table-note')).toContainText('out of requests for this hour');
  await expect(page.locator('.table-note')).toContainText('60 to 5000');
});

test('the root repository travels in the URL, the token never does', async ({ page }) => {
  const calls = [];
  await stub(page, calls);
  await page.goto('/?view=forks&repo=someone%2Fcore');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__mig.forkTree.root)).toBe('someone/core');

  await page.evaluate(() => { window.__mig.forkTree.api.token = 'ghp_pretend'; });
  await page.locator('#btn-filter').click();
  await page.locator('#fork-root').fill('other/core-fork');
  await page.locator('#fork-root').dispatchEvent('change');

  const search = await page.evaluate(() => window.location.search);
  expect(search).toContain('repo=other%2Fcore-fork');
  expect(search).not.toContain('ghp_pretend');
  expect(search).not.toContain('token');
});

test('without a server token the visitor may supply one', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);

  await page.locator('#btn-filter').click();
  await expect(page.locator('.token-field')).toBeVisible();
});

test('pagination follows rel=next and stops without it', async ({ page }) => {
  const seen = [];
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    seen.push(url.pathname + url.search);
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'Link, X-RateLimit-Limit, X-RateLimit-Remaining',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '50',
    };
    const json = body => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });

    if (path === '/repos/infinito-nexus/core') return json(ROOT);
    if (path === '/repos/infinito-nexus/core/forks') return json([]);
    if (path.endsWith('/tags')) return json([{ name: 'v1' }]);
    if (path.endsWith('/branches')) {
      const page2 = url.searchParams.get('page') === '2';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: page2
          ? {
            ...headers,
            // Last page: a Link header IS present, but without rel=next.
            link: '<https://api.github.com/repos/infinito-nexus/core/branches?per_page=100&page=1>; rel="prev", '
              + '<https://api.github.com/repos/infinito-nexus/core/branches?per_page=100&page=1>; rel="first"',
          }
          : {
            ...headers,
            link: '<https://api.github.com/repos/infinito-nexus/core/branches?per_page=100&page=2>; rel="next", '
              + '<https://api.github.com/repos/infinito-nexus/core/branches?per_page=100&page=2>; rel="last"',
          },
        body: JSON.stringify(page2 ? [{ name: 'three' }] : [{ name: 'one' }, { name: 'two' }]),
      });
    }
    return json([]);
  });

  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(1);

  await page.locator('.fork-toggle').first().click();
  const body = page.locator('.fork-body').first();
  await expect(body).toContainText('Branches (3)');
  await expect(body).toContainText('three');

  const branchCalls = seen.filter(s => s.includes('/branches'));
  expect(branchCalls.length, 'exactly two pages, then stop').toBe(2);
  expect(branchCalls[1]).toContain('page=2');
});
