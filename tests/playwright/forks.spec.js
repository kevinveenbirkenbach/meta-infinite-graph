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

// A trunk of three with two merged side commits. The second side is older than
// the first one's whole life, so the two never overlap in time and the graph
// has to put them in the SAME column instead of opening a second one.
const COMMITS = [
  { sha: 'aaa1', parents: [{ sha: 'aaa2' }, { sha: 'bbb1' }],
    commit: { message: 'Merge one', committer: { date: '2026-09-03T00:00:00Z' } } },
  { sha: 'bbb1', parents: [{ sha: 'aaa3' }],
    commit: { message: 'side one', committer: { date: '2026-09-02T12:00:00Z' } } },
  { sha: 'aaa2', parents: [{ sha: 'aaa3' }, { sha: 'ccc1' }],
    commit: { message: 'Merge two', committer: { date: '2026-09-01T00:00:00Z' } } },
  { sha: 'ccc1', parents: [{ sha: 'aaa3' }],
    commit: { message: 'side two', committer: { date: '2026-08-31T00:00:00Z' } } },
  { sha: 'aaa3', parents: [],
    commit: { message: 'root commit', committer: { date: '2026-08-30T00:00:00Z' } } },
];

function stub(page, counter) {
  return page.route('https://api.github.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    counter.push(path);
    const body = (() => {
      if (path === '/repos/infinito-nexus/core') return ROOT;
      if (path === '/repos/infinito-nexus/core/forks') return FORKS;
      if (path.endsWith('/branches')) return [{ name: 'main' }, { name: HOSTILE }];
      if (path.endsWith('/tags')) return [{ name: 'v13.0.0' }, { name: 'v11.6.0' }];
      if (path.endsWith('/commits')) return COMMITS;
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

  expect(calls.slice(0, 2), 'the listings come first').toEqual(
    ['/repos/infinito-nexus/core', '/repos/infinito-nexus/core/forks']
  );
  await expect
    .poll(() => calls.filter(path => path.endsWith('/commits')).length)
    .toBe(3);
});

test('branches and tags load only when a node is opened', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  // Two listings plus one history per repository, because the branch lines are
  // on by default; the refs themselves still wait for a node to be opened.
  await expect.poll(() => calls.length).toBe(5);

  await page.locator('.fork-toggle').first().click();
  await expect.poll(() => calls.length).toBe(7);
  expect(calls.slice(5).sort(), 'only the refs are new; the history is cached').toEqual([
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

test('the plot draws a life line per repository and an edge per fork', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect(page.locator('svg.fork-plot')).toBeVisible();

  const shape = await page.evaluate(() => ({
    lifes: document.querySelectorAll('svg.fork-plot .fork-life').length,
    edges: document.querySelectorAll('svg.fork-plot .fork-edge').length,
    labels: [...document.querySelectorAll('svg.fork-plot .fork-label title')].map(t => t.textContent),
    commits: document.querySelectorAll('svg.fork-plot .fork-commit').length,
  }));

  expect(shape.lifes, 'the root and both forks').toBe(3);
  expect(shape.edges, 'one edge per fork').toBe(2);
  expect(shape.labels).toEqual(['infinito-nexus/core', 'someone/core', 'other/core-fork']);
  expect(shape.commits, 'no history is fetched until a repository is opened').toBe(0);
});

test('the commit lanes carry the merges of every repository', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect(page.locator('svg.fork-plot')).toBeVisible();
  await expect
    .poll(() => page.locator('svg.fork-plot .fork-commit').count(), { timeout: 30000 })
    .toBe(15);

  const drawn = await page.evaluate(() => ({
    merges: document.querySelectorAll('svg.fork-plot .fork-commit.merge').length,
    mergeEdges: document.querySelectorAll('svg.fork-plot .fork-merge').length,
    lanes: document.querySelectorAll('svg.fork-plot .fork-lane').length,
  }));

  // The stub answers every repository with the same five commits, so each of
  // the three carries two merges and shares one side column with its trunk.
  expect(drawn.merges, 'two of five commits carry a second parent').toBe(6);
  expect(drawn.mergeEdges, 'each merge joins a side lane into the trunk').toBe(6);
  expect(drawn.lanes, 'both side branches share one column, so trunk plus one').toBe(6);
  expect(calls.filter(path => path.endsWith('/commits')).length,
    'one call per repository, not one per branch').toBe(3);
});

test('branch lines are drawn by default and the design panel turns them off',
  async ({ page }) => {
    const calls = [];
    await openForks(page, calls);
    await expect(page.locator('svg.fork-plot')).toBeVisible();

    // Default on: the lanes appear without opening a single repository. The
    // walk is serial, so the count has to settle before it is read.
    await expect
      .poll(() => calls.filter(path => path.endsWith('/commits')).length, { timeout: 30000 })
      .toBe(3);
    const perRepo = calls.filter(path => path.endsWith('/commits'));
    expect(await page.locator('svg.fork-plot .fork-commit').count()).toBeGreaterThan(0);

    await page.locator('#btn-design').click();
    await page.locator('#design-branches').uncheck();
    await expect.poll(() => page.locator('svg.fork-plot .fork-commit').count()).toBe(0);
    expect(await page.locator('svg.fork-plot .fork-life').count(),
      'the fork network stays, only its commit lanes go').toBe(3);
    await expect.poll(() => page.evaluate(() => window.location.search))
      .toContain('branches=false');

    await page.locator('#design-branches').check();
    await expect
      .poll(() => page.locator('svg.fork-plot .fork-commit').count(), { timeout: 30000 })
      .toBeGreaterThan(0);
    expect(calls.filter(path => path.endsWith('/commits')).length,
      'the cache answers the second time, so nothing is spent again').toBe(perRepo.length);
  });

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

test('hovering a commit opens a card naming it', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect
    .poll(() => page.locator('svg.fork-plot .fork-commit').count(), { timeout: 30000 })
    .toBeGreaterThan(0);

  // Row groups are drawn in fork order, so the first one is the root.
  await page.locator('svg.fork-plot .fork-row').first()
    .locator('.fork-commit').last().hover();
  const card = page.locator('.role-card-host .commit-card');
  await expect(card).toBeVisible();
  await expect(card, 'the card names the repository its dot belongs to')
    .toContainText('infinito-nexus/core');
  await expect(card).toContainText('Parents');
});

test('a hostile branch name is rendered as text, not as markup', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await page.locator('.fork-toggle').first().click();
  await expect.poll(() => calls.length).toBe(7);

  const body = page.locator('.fork-body').first();
  await expect(body).toContainText(HOSTILE);
  expect(await body.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('the cache spares the quota on a second visit', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);
  await expect.poll(() => calls.length).toBe(5);

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
  await expect(page.locator('.role-card-host .role-card-close')).toBeVisible();

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
  await expect.poll(() => page.locator('.fork-tree .fork-name').count()).toBe(3);

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
