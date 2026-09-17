const { test, expect } = require('@playwright/test');
const { ROOT, FORKS, COMMITS, labels, stub, openForks } = require('../support/forks');

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
  await expect.poll(() => labels(page)).toHaveLength(3);

  await page.locator('#btn-filter').click();
  await expect(page.locator('.token-field')).toBeVisible();
  await expect(page.locator('#fork-token-owned')).toBeHidden();
  expect(await page.evaluate(() => window.__mig.forkTree.api.base)).toBe('https://api.github.com');
});

test('hovering the token field explains how to create and how to persist one', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await page.locator('#btn-filter').click();
  await expect(page.locator('.token-field')).toBeVisible();

  await page.locator('#fork-token').hover();
  const card = page.locator('.role-card-host .token-help');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Public repositories (read-only)');
  await expect(card).toContainText('github_pat_');
  await expect(card).toContainText('MIG_GITHUB_TOKEN=github_pat_');
  await expect(card).toContainText('5000 an hour');
  await expect(card.locator('a[href*="settings/personal-access-tokens"]')).toHaveCount(1);
  await expect(page.locator('.role-card-host .popup-close')).toBeVisible();

  await page.mouse.move(2, 2);
  await expect(page.locator('.role-card-host')).toHaveCount(0);
});

test('a server token hides the field and routes through the proxy', async ({ page }) => {
  const paths = [];
  await page.route('**/gh-config.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ proxy: true }),
  }));
  await page.route('**/gh/**', route => {
    const url = new URL(route.request().url());
    paths.push(url.pathname);
    const body = url.pathname.endsWith('/forks') ? FORKS
      : url.pathname.endsWith('/commits') ? COMMITS : ROOT;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998' },
      body: JSON.stringify(body),
    });
  });
  await page.route('https://api.github.com/**', route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('mig-gh-token', 'ghp_visitor');
    localStorage.removeItem('mig-gh-cache');
  });

  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.locator('label[for="view-forks"]').click();
  await expect.poll(() => labels(page)).toHaveLength(3);

  await page.locator('#btn-filter').click();
  await expect(page.locator('.token-field')).toBeHidden();
  await expect(page.locator('#fork-token-owned')).toBeVisible();

  expect(paths.slice(0, 2)).toEqual(
    ['/gh/repos/infinito-nexus/core', '/gh/repos/infinito-nexus/core/forks']
  );
  await expect
    .poll(() => paths.filter(path => path.endsWith('/commits')).length)
    .toBe(3);
  expect(await page.evaluate(() => window.__mig.forkTree.api.token),
    'a visitor token is dropped when the server holds one').toBe('');
  await expect(page.locator('.table-note')).toContainText('4998 of 5000');
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
    if (path.endsWith('/commits')) return json(COMMITS);
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
  await expect.poll(() => labels(page)).toHaveLength(1);

  await page.locator('svg.fork-plot .fork-label.root').click();
  await expect.poll(() => labels(page)).toEqual([
    'infinito-nexus/core', 'infinito-nexus/core@one', 'infinito-nexus/core@two', 'infinito-nexus/core@three',
  ]);

  const branchCalls = seen.filter(s => s.includes('/branches'));
  expect(branchCalls.length, 'exactly two pages, then stop').toBe(2);
  expect(branchCalls[1]).toContain('page=2');
});
