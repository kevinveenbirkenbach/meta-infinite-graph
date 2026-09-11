const { test, expect } = require('@playwright/test');
const { boot } = require('./support/mirror');

const CORE = 'infinito-nexus/core';
const FORK = 'someone/core';

const FOUND = {
  [`${CORE}/security-advisories`]: [{
    ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', summary: 'Template injection in the role loader',
    published_at: '2026-05-01T00:00:00Z', html_url: `https://github.com/${CORE}/security/advisories/GHSA-aaaa-bbbb-cccc`,
  }],
  [`${FORK}/security-advisories`]: [],
  [`${CORE}/dependabot/alerts`]: [{
    number: 3, security_advisory: { severity: 'critical', summary: 'Prototype pollution' },
    dependency: { package: { name: 'js-yaml' } },
    created_at: '2026-08-01T00:00:00Z', html_url: `https://github.com/${CORE}/security/dependabot/3`,
  }],
  [`${CORE}/code-scanning/alerts`]: [
    {
      number: 9, rule: { security_severity_level: 'medium', severity: 'warning', description: 'Unsafe shell command' },
      created_at: '2026-07-01T00:00:00Z', html_url: `https://github.com/${CORE}/security/code-scanning/9`,
    },
    {
      number: 10, rule: { severity: 'note', description: 'Unused variable' },
      created_at: '2026-07-02T00:00:00Z', html_url: `https://github.com/${CORE}/security/code-scanning/10`,
    },
  ],
  [`${CORE}/secret-scanning/alerts`]: [{
    number: 1, secret_type_display_name: 'GitHub Personal Access Token',
    created_at: '2026-06-01T00:00:00Z', html_url: `https://github.com/${CORE}/security/secret-scanning/1`,
  }],
};

const REFUSED = {
  [`${FORK}/dependabot/alerts`]: 403,
  [`${FORK}/code-scanning/alerts`]: 404,
  [`${FORK}/secret-scanning/alerts`]: 401,
};

function answer(route, calls, prefix) {
  const url = new URL(route.request().url());
  const key = url.pathname.replace(prefix, '');
  calls.push(url.pathname + url.search);
  route.fulfill({
    status: REFUSED[key] || 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining',
      'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900',
    },
    body: JSON.stringify(REFUSED[key] ? { message: 'no' } : FOUND[key] || []),
  });
}

async function direct(page, calls) {
  await page.route('https://api.github.com/**', route => answer(route, calls, '/repos/'));
  await boot(page, calls, '?refs=main,f1/master');
}

async function proxied(page, calls, alerts) {
  await page.route('**/gh-config.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ proxy: true, alerts }),
  }));
  await page.route('**/gh/**', route => answer(route, calls, '/gh/repos/'));
  await page.route('https://api.github.com/**', route => {
    calls.push(`direct:${new URL(route.request().url()).pathname}`);
    route.abort();
  });
  await boot(page, calls, '?refs=main,f1/master');
}

const cell = (page, repo, source) => page.locator(`.security-summary tr[data-repo="${repo}"] td[data-source="${source}"]`);

test('the security tab gathers every source of every ticked repository, worst first', async ({ page }) => {
  const calls = [];
  await direct(page, calls);
  await page.locator('label[for="view-security"]').click();

  const rows = page.locator('table.security-table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 30000 }).toBe(5);
  expect(await rows.locator('td.security-severity').allTextContents())
    .toEqual(['critical', 'high', 'medium', 'note', 'unrated']);
  await expect(rows.first()).toContainText('js-yaml: Prototype pollution');
  expect(await rows.first().locator('td.security-severity').evaluate(cell => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--bs-danger)';
    const danger = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(cell).color === danger;
  }), 'the table style must not paint over the severity').toBe(true);
  await expect(rows.first().locator('a')).toHaveAttribute('href', /\/security\/dependabot\/3$/);

  await expect(cell(page, CORE, 'codeScanning')).toHaveText('2');
  await expect(cell(page, FORK, 'advisories')).toHaveText('0');
  for (const source of ['dependabot', 'codeScanning', 'secretScanning']) {
    await expect(cell(page, FORK, source), 'a refusal stays in its own cell').toHaveText('no access');
  }
  await expect(page.locator('.table-note')).toContainText('5 open findings in 2 repositories');
  await expect(page.locator('.table-note')).toContainText('"no access" means');

  expect(calls.filter(call => call.includes('/alerts')).every(call => call.includes('state=open')),
    'only open alerts are asked for').toBe(true);
  expect(calls.filter(call => call.includes('/secret-scanning/')).every(call => call.includes('hide_secret=true')),
    'no secret ever travels, not even to the visitor who owns it').toBe(true);
  expect(calls.filter(call => call.includes('/security-advisories')).every(call => call.includes('state=published')))
    .toBe(true);
});

test('behind the server token the alerts stay withheld unless the instance allows them', async ({ page }) => {
  const calls = [];
  await proxied(page, calls, false);
  await page.locator('label[for="view-security"]').click();

  await expect.poll(() => page.locator('table.security-table tbody tr').count(), { timeout: 30000 }).toBe(1);
  expect(calls.filter(call => !call.startsWith('log:')).sort(),
    'only the public advisories are asked for, and only through the proxy').toEqual([
    `/gh/repos/${CORE}/security-advisories?state=published&per_page=100`,
    `/gh/repos/${FORK}/security-advisories?state=published&per_page=100`,
  ]);
  await expect(cell(page, CORE, 'dependabot')).toHaveText('withheld');
  await expect(cell(page, CORE, 'dependabot').locator('a'))
    .toHaveAttribute('href', `https://github.com/${CORE}/security/dependabot`);
  await expect(page.locator('.table-note')).toContainText('MIG_GITHUB_ALERTS=true');
});

test('an instance that allows alerts reads them through its proxy', async ({ page }) => {
  const calls = [];
  await proxied(page, calls, true);
  await page.locator('label[for="view-security"]').click();

  await expect.poll(() => page.locator('table.security-table tbody tr').count(), { timeout: 30000 }).toBe(5);
  expect(calls.filter(call => call.startsWith('/gh/')).length, 'four sources for each of two repositories').toBe(8);
  expect(calls.filter(call => call.startsWith('direct:'))).toEqual([]);
});

test('with nothing ticked the security tab asks GitHub nothing', async ({ page }) => {
  const calls = [];
  await page.route('https://api.github.com/**', route => answer(route, calls, '/repos/'));
  await boot(page, calls, '?refs=none/at-all');
  await page.locator('label[for="view-security"]').click();
  await expect(page.locator('.table-note')).toContainText('No source ticked');
  expect(calls.filter(call => !call.startsWith('log:'))).toEqual([]);
});
