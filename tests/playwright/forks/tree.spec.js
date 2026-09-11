const { test, expect } = require('@playwright/test');
const { HOSTILE, NESTED, enterForks, labels, openForks, stub } = require('../support/forks');

const NETWORK = ['infinito-nexus/core', 'someone/core', 'other/core-fork'];

test('the timeline labels the root and its forks and is the whole view', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);

  await expect.poll(() => labels(page)).toEqual(NETWORK);
  await expect(page.locator('svg.fork-plot .fork-label').first()).toHaveClass(/root/);
  expect(await page.locator('.fork-plot-host ~ *').count(), 'nothing is listed below the timeline').toBe(0);
  await expect(page.locator('.table-note')).toContainText('2 direct forks');
  await expect(page.locator('.table-note')).toContainText('requests left this hour');

  expect(calls.slice(0, 2), 'the listings come first').toEqual(
    ['/repos/infinito-nexus/core', '/repos/infinito-nexus/core/forks']
  );
  await expect
    .poll(() => calls.filter(path => path.endsWith('/commits')).length)
    .toBe(3);
});

test('clicking a repository opens its branches as rows beneath it', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => labels(page)).toEqual(NETWORK);
  // Two listings plus one history per repository, because the branch lines are
  // on by default; the branches themselves wait for a repository to be opened.
  await expect.poll(() => calls.length).toBe(5);
  const root = page.locator('svg.fork-plot .fork-label.root');
  await expect(root).toHaveAttribute('aria-expanded', 'false');

  await root.click();
  await expect.poll(() => labels(page))
    .toEqual([NETWORK[0], `${NETWORK[0]}@${HOSTILE}`, NETWORK[1], NETWORK[2]]);
  expect(calls.slice(5), 'the listing, then one history per branch but the default').toEqual([
    '/repos/infinito-nexus/core/branches',
    '/repos/infinito-nexus/core/commits',
  ]);
  await expect(page.locator('svg.fork-plot .fork-label.root')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('svg.fork-plot .fork-row').nth(1).locator('.fork-commit').count(),
    'the branch row carries only the commit its trunk lacks').toBe(1);
  expect(await page.locator('svg.fork-plot .fork-edge').count(),
    'two forks and the branch leaving its trunk').toBe(3);

  await page.locator('svg.fork-plot .fork-label.root').click();
  await expect.poll(() => labels(page)).toEqual(NETWORK);
  await page.locator('svg.fork-plot .fork-label.root').press('Enter');
  await expect.poll(() => labels(page)).toHaveLength(4);
  expect(calls.length, 'reopening answers from memory').toBe(7);
});

test('opening a fork that is forked again walks one level deeper', async ({ page }) => {
  const calls = [];
  await openForks(page, calls);
  await expect.poll(() => calls.length).toBe(5);

  await page.locator('svg.fork-plot .fork-label[data-repo="other/core-fork"]').click();
  await expect.poll(() => labels(page)).toEqual([
    ...NETWORK,
    'other/core-fork@main',
    `other/core-fork@${HOSTILE}`,
    NESTED.full_name,
  ]);
  expect(calls).toContain('/repos/other/core-fork/forks');
  await expect.poll(() => calls.filter(path => path === `/repos/${NESTED.full_name}/commits`).length,
    'the new fork gets its history like every other').toBe(1);
});

test('the plot draws a life line per repository and an edge per fork', async ({ page }) => {
  const calls = [];
  await stub(page, calls);
  let release;
  const histories = new Promise(resolve => { release = resolve; });
  await page.route(/\/commits(\?|$)/, route => histories.then(() => route.fallback()));
  await enterForks(page);
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
  expect(shape.commits, 'the fork network is drawn before any history arrives').toBe(0);
  release();
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

test('a tag older than the fetched commits is dated by its own lookup',
  async ({ page }) => {
    const calls = [];
    await openForks(page, calls);
    await expect(page.locator('svg.fork-plot')).toBeVisible();
    expect(await page.locator('svg.fork-plot .fork-tag').count(),
      'tags stay off until the design panel asks for them').toBe(0);

    await page.locator('#btn-design').click();
    await page.locator('#design-tags').check();
    await expect
      .poll(() => page.locator('svg.fork-plot .fork-tag').count(), { timeout: 30000 })
      .toBe(6);

    expect(calls.filter(path => path.endsWith('/commits/old9')).length,
      'the tag inside the history is free, the one outside costs one call').toBe(3);
    await expect(page.locator('.fork-tag-note')).toHaveText('6 of 6 tags placed.');
    await expect.poll(() => page.evaluate(() => window.location.search)).toContain('tags=true');
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
  await expect.poll(() => calls.length).toBe(5);
  await page.locator('svg.fork-plot .fork-label.root').click();

  const branch = page.locator('svg.fork-plot .fork-label.branch');
  await expect(branch.locator('title')).toHaveText(`infinito-nexus/core@${HOSTILE}`);
  await expect(branch).toContainText('<img');
  expect(await page.locator('.fork-plot-host img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});
