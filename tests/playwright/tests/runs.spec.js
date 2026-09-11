const { test, expect } = require('@playwright/test');

const ROLE = 'web-app-nextcloud';
const TITLE = 'admin: nextcloud oidc login and logout';
const REPORT = `debian/${ROLE}/${ROLE}/variant-1/sync`;
const VIDEO = `${REPORT}/test-results/login-admin/video.webm`;

const RUNS = {
  workflow_runs: [
    {
      id: 900, run_number: 42, path: '.github/workflows/entry-push-latest.yml', display_title: 'Push to main',
      head_branch: 'main', created_at: '2026-09-10T08:00:00Z', conclusion: 'failure',
    },
    {
      id: 901, run_number: 43, path: '.github/workflows/cron-security-scorecard.yml', display_title: 'Scorecard',
      head_branch: 'main', created_at: '2026-09-10T09:00:00Z', conclusion: 'success',
    },
  ],
};

const ARTIFACTS = {
  1: [
    { id: 71, name: `playwright-compose-${ROLE}-1-debian-btrfs` },
    { id: 72, name: `inventory-compose-${ROLE}-1-debian-btrfs` },
  ],
  2: [{ id: 73, name: 'playwright-swarm-web-app-odoo-0-centos-zfs' }],
};

const RESULTS = {
  id: 71,
  name: `playwright-compose-${ROLE}-1-debian-btrfs`,
  reports: [{
    app: ROLE, variant: 1, phase: 'sync', report: `${REPORT}/playwright-report/index.html`, videos: [VIDEO],
    tests: [{ name: TITLE, status: 'failed', time: 12, message: 'expected 200, got 502', attachments: [VIDEO] }],
  }],
};

async function wire(page, calls, artifact) {
  await page.route('https://api.github.com/**', route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    const body = url.pathname.endsWith('/actions/runs') ? RUNS
      : url.pathname.endsWith('/runs/900/artifacts')
        ? { total_count: 3, artifacts: ARTIFACTS[url.searchParams.get('page')] || [] }
        : {};
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  await page.route('**/git/artifact?id=*', route => {
    calls.push(`artifact:${new URL(route.request().url()).searchParams.get('id')}`);
    route.fulfill(artifact);
  });
}

async function open(page, calls, artifact, query = '') {
  await wire(page, calls, artifact);
  await page.goto(`/?view=playwright${query}`);
  await expect.poll(() => page.locator('table.tests-matrix td[data-cell]').count(), { timeout: 180000 })
    .toBeGreaterThan(300);
  await page.evaluate(() => window.__mig.forkTree.api.forget());
}

async function hoverTest(page) {
  const key = await page.evaluate(([role, title]) => {
    for (const [cell, row] of window.__mig.testsView.detail) {
      if (row.role === role && row.test === title) return cell;
    }
    return null;
  }, [ROLE, TITLE]);
  expect(key, `${ROLE} declares "${TITLE}"`).not.toBeNull();
  await page.locator(`td[data-cell="${key}"]`).hover();
  return page.locator('.role-card-host .test-card');
}

const ok = { status: 200, contentType: 'application/json', body: JSON.stringify(RESULTS) };

test('picking an Actions run marks the lines that ran and dims the rest', async ({ page }) => {
  const calls = [];
  await open(page, calls, ok);
  const picker = page.locator('.tests-run select');
  await expect(picker.locator('option'), 'only the runs that deploy are offered')
    .toHaveText(['no run', '#42 · Push to main · main · 2026-09-10 · failure']);

  await picker.selectOption('900');
  await expect(page.locator('table.tests-matrix thead th').nth(3)).toHaveText('run');
  await expect(page.locator('.table-note')).toContainText('2 of');
  await expect(page.locator('.table-note')).toContainText('lines ran in run #42');
  const shape = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('table.tests-matrix tbody tr')];
    return {
      lines: lines.length,
      ran: lines.filter(line => line.querySelector('th.tests-ran').textContent.trim() === '▶')
        .map(line => line.querySelector('th[data-role-name]').dataset.roleName),
      absent: lines.filter(line => line.classList.contains('tests-absent')).length,
    };
  });
  expect(shape.ran, 'the inventory artifact is not a test run; the swarm one on page 2 is')
    .toEqual([ROLE, 'web-app-odoo'].sort());
  expect(shape.absent, 'every other line is dimmed').toBe(shape.lines - 2);
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('run=900');
  expect(calls.filter(call => call.includes('/runs/900/artifacts')), 'every page of artifacts is read')
    .toEqual([
      '/repos/infinito-nexus/core/actions/runs/900/artifacts?per_page=100&page=1',
      '/repos/infinito-nexus/core/actions/runs/900/artifacts?per_page=100&page=2',
    ]);
});

test('the card downloads the artifact once and links the test\'s video', async ({ page }) => {
  const calls = [];
  await open(page, calls, ok, '&run=900');
  await expect(page.locator('.tests-run select')).toHaveValue('900');

  const card = await hoverTest(page);
  await expect(card, 'a run taken from the URL still shows its number, not its id').toContainText('Run #42');
  await expect(card.locator('.test-result')).toHaveText('failed');
  await expect(card).toContainText('expected 200, got 502');
  await expect(card.locator('a', { hasText: 'Video' })).toHaveAttribute('href', `/artifacts/71/${VIDEO}`);
  await expect(card.locator('a', { hasText: 'Report' }))
    .toHaveAttribute('href', `/artifacts/71/${REPORT}/playwright-report/index.html`);

  const viewer = page.locator('.artifact-viewer');
  await card.locator('a', { hasText: 'Video' }).click();
  await expect(viewer.locator('video'), 'the video plays in a popup on the page').toHaveAttribute('src', `/artifacts/71/${VIDEO}`);
  expect(page.url(), 'the page stays where it was').toContain('view=playwright');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  await (await hoverTest(page)).locator('a', { hasText: 'Report' }).click();
  const frame = viewer.locator('iframe');
  await expect(frame).toHaveAttribute('src', `/artifacts/71/${REPORT}/playwright-report/index.html`);
  await expect(frame, 'the report runs sandboxed in its frame').toHaveAttribute('sandbox', 'allow-scripts');
  await viewer.click({ position: { x: 5, y: 5 } });
  await expect(viewer).toHaveCount(0);

  await page.mouse.move(2, 2);
  await expect(page.locator('.role-card-host')).toHaveCount(0);
  await expect((await hoverTest(page)).locator('.test-result')).toHaveText('failed');
  expect(calls.filter(call => call.startsWith('artifact:')).sort(),
    'every artifact of the run is fetched once, the cards read what is already in').toEqual(['artifact:71', 'artifact:73']);
});

test('the cells of a line turn while its artifact downloads, then show how each test did', async ({ page }) => {
  const calls = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await wire(page, calls, ok);
  await page.route('**/git/artifact?id=*', route => held.then(() => route.fallback()));
  await page.goto('/?view=playwright&run=900');
  await expect.poll(() => page.locator('table.tests-matrix td[data-cell]').count(), { timeout: 180000 })
    .toBeGreaterThan(300);

  const cells = page.locator(`table.tests-matrix tr:has(th[data-role-name="${ROLE}"]) td.run-cell`);
  await expect.poll(() => cells.count(), { timeout: 30000 }).toBeGreaterThan(1);
  await expect(cells.locator('.cell-spin').first(), 'a line whose artifact is on its way turns').toBeVisible();

  release();
  await expect(page.locator(`table.tests-matrix td.run-cell .cell-spin`)).toHaveCount(0);
  const key = await page.evaluate(([role, title]) => {
    for (const [cell, row] of window.__mig.testsView.detail) {
      if (row.role === role && row.test === title) return cell;
    }
    return null;
  }, [ROLE, TITLE]);
  const failed = page.locator(`td[data-cell="${key}"]`);
  await expect(failed).toHaveClass(/run-failed/);
  await expect(failed).toHaveText('✗');
  await expect(cells.filter({ hasText: '·' }).first(), 'a test its report does not list says so')
    .toHaveClass(/run-missing/);
});

test('a server without a token says so in the card', async ({ page }) => {
  const calls = [];
  await open(page, calls, {
    status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'downloading an artifact needs MIG_GITHUB_TOKEN on the server' }),
  }, '&run=900');
  const card = await hoverTest(page);
  await expect(card.locator('.fork-error')).toContainText('needs MIG_GITHUB_TOKEN');
});
