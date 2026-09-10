const { test, expect } = require('@playwright/test');
const { ROOT, FORKS, COMMITS, openForks } = require('../support/forks');

test('a deep link into the fork view still waits for the proxy', async ({ page }) => {
  const paths = [];
  // Delayed on purpose: the answer has to arrive after the view would other-
  // wise have started fetching, which is what used to send it past the proxy.
  await page.route('**/gh-config.json', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ proxy: true }),
    });
  });
  await page.route('**/gh/**', route => {
    const url = new URL(route.request().url());
    paths.push(url.pathname);
    const body = url.pathname.endsWith('/forks') ? FORKS
      : url.pathname.endsWith('/commits') ? COMMITS : ROOT;
    route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998' },
      body: JSON.stringify(body),
    });
  });
  const direct = [];
  await page.route('https://api.github.com/**', route => {
    direct.push(new URL(route.request().url()).pathname);
    route.abort();
  });

  await page.goto('/?view=forks');
  await expect
    .poll(() => page.locator('svg.fork-plot .fork-life').count(), { timeout: 60000 })
    .toBe(3);

  expect(direct, 'not one call may bypass the proxy').toEqual([]);
  expect(paths.length, 'every call went through the proxy').toBeGreaterThan(2);

  // The note has to name the path taken, or a proxied page reporting the
  // unauthenticated wording is indistinguishable from a broken proxy.
  await expect(page.locator('.table-note')).toContainText("through the server's token");
  await expect(page.locator('.table-note')).toContainText('4998 of 5000');
});

test('a repository without a default branch asks for no ref at all', async ({ page }) => {
  const paths = [];
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    paths.push(url.pathname + url.search);
    const body = url.pathname === '/repos/infinito-nexus/core' ? { ...ROOT, default_branch: undefined }
      : url.pathname.endsWith('/forks') ? []
        : url.pathname.endsWith('/commits') ? COMMITS : [];
    route.fulfill({
      status: 200, contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
        'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '55',
      },
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();
  await expect
    .poll(() => page.locator('svg.fork-plot .fork-commit').count(), { timeout: 30000 })
    .toBeGreaterThan(0);

  const asked = paths.filter(path => path.includes('/commits'));
  expect(asked, 'exactly one history call').toHaveLength(1);
  expect(asked[0], 'no sha=undefined may reach GitHub').not.toContain('sha=');
});

test('a commit history stops at one page even when GitHub offers more',
  async ({ page }) => {
    const paths = [];
    await page.route('https://api.github.com/**', route => {
      const url = new URL(route.request().url());
      paths.push(url.pathname + url.search);
      const commits = url.pathname.endsWith('/commits');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'Link, X-RateLimit-Limit, X-RateLimit-Remaining',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '55',
          // GitHub answers the next page under the numeric id, not the name.
          ...(commits ? {
            link: '<https://api.github.com/repositories/42/commits?per_page=100&page=2>; rel="next"',
          } : {}),
        },
        body: JSON.stringify(
          url.pathname === '/repos/infinito-nexus/core' ? ROOT
            : url.pathname.endsWith('/forks') ? []
              : commits ? COMMITS : []
        ),
      });
    });

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
      .toBe(true);
    await page.evaluate(() => window.__mig.forkTree.api.forget());
    await page.locator('label[for="view-forks"]').click();
    await expect
      .poll(() => page.locator('svg.fork-plot .fork-commit').count(), { timeout: 30000 })
      .toBe(COMMITS.length);

    // The plot draws one window, so walking the whole history would cost dozens
    // of requests for commits it never shows.
    expect(paths.filter(path => path.includes('page=2')),
      'rel=next is offered and must be declined').toEqual([]);
    expect(paths.filter(path => path.includes('/commits'))).toHaveLength(1);
  });

test('a refused history says so instead of drawing an empty plot', async ({ page }) => {
  const calls = [];
  await page.route('https://api.github.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': path.endsWith('/commits') ? '0' : '58',
    };
    if (path.endsWith('/commits')) {
      return route.fulfill({
        status: 403, contentType: 'application/json', headers,
        body: JSON.stringify({ message: 'API rate limit exceeded' }),
      });
    }
    const body = path === '/repos/infinito-nexus/core' ? ROOT
      : path.endsWith('/forks') ? FORKS : [];
    return route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
  });

  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();

  await expect(page.locator('.fork-plot-host .fork-error'))
    .toContainText('out of requests for this hour');
  await expect(page.locator('.fork-plot-host .fork-error'))
    .toContainText('fork network above is complete');

  expect(await page.locator('svg.fork-plot .fork-life').count(),
    'the network still draws from the listings alone').toBe(3);
  expect(await page.locator('svg.fork-plot .fork-commit').count()).toBe(0);
  expect(calls.filter(path => path.endsWith('/commits')).length,
    'the walk stops at the first refusal rather than spending the rest').toBe(1);
});

test('the cache spares the quota on a second visit', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  await expect.poll(() => calls.length).toBe(5);

  await page.locator('#btn-roles').click();
  await page.locator('label[for="view-graph"]').click();
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  expect(calls.length, 'a reload must not spend a single request').toBe(5);
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
