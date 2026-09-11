const { expect } = require('@playwright/test');

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

function mirror(page, calls) {
  return Promise.all([
    page.route('**/git/catalog', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG),
    })),
    page.route('**/git/checkout*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sha: SHA, date: '2026-09-08T00:00:00Z', path: `/at/${SHA}/` }),
    })),
    page.route('**/git/log*', route => {
      const ref = new URL(route.request().url()).searchParams.get('ref');
      calls.push(`log:${ref}`);
      route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(LOG[ref] || []),
      });
    }),
    page.route(`**/at/${SHA}/**`, route => {
      const url = new URL(route.request().url());
      const served = url.pathname.replace(`/at/${SHA}/meta/`, '/infinito_meta/').replace(`/at/${SHA}/`, '/');
      route.continue({ url: `${url.origin}${served}${url.search}` });
    }),
  ]);
}

// Args:
//   query: the page's search string, which carries the ticked refs.
// The GitHub routes are the caller's and must be in place before this runs.
async function boot(page, calls, query = '') {
  await mirror(page, calls);
  await page.goto(`/${query}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__mig)), { timeout: 120000 }).toBe(true);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
}

module.exports = { SHA, CATALOG, LOG, mirror, boot };
