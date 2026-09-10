const { expect } = require('@playwright/test');

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

// v13 sits on a commit the fetched page carries; v11 points at one older than
// it, which is the only case a date lookup exists for.
const TAGS = [
  { name: 'v13.0.0', commit: { sha: 'aaa2' } },
  { name: 'v11.6.0', commit: { sha: 'old9' } },
];

function stub(page, counter) {
  return page.route('https://api.github.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    counter.push(path);
    const body = (() => {
      if (path === '/repos/infinito-nexus/core') return ROOT;
      if (path === '/repos/infinito-nexus/core/forks') return FORKS;
      if (path.endsWith('/branches')) return [{ name: 'main' }, { name: HOSTILE }];
      if (path.endsWith('/tags')) return TAGS;
      if (/\/commits\/[0-9a-z]+$/.test(path)) {
        return { sha: path.split('/').pop(), commit: { committer: { date: '2026-08-20T00:00:00Z' } } };
      }
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

async function enterForks(page) {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.forkTree)), { timeout: 60000 })
    .toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
  await page.locator('label[for="view-forks"]').click();
}

async function openForks(page, counter) {
  await stub(page, counter);
  await enterForks(page);
}

module.exports = { ROOT, FORKS, HOSTILE, COMMITS, stub, enterForks, openForks };
