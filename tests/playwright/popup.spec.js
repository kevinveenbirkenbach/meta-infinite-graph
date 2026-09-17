const { test, expect } = require('@playwright/test');
const { open2d, hoverRoleWithDependencies } = require('./support/tables');

const CONTROLS = ['−', '⤢', '×'];

test('the loader overview outlives the pointer as long as a card does', async ({ page }) => {
  await open2d(page);
  const overview = page.locator('#loader-overview');
  await page.locator('#view-loader').hover();
  await expect(overview).toBeVisible();

  await page.locator('h2').first().hover();
  await expect(overview, 'it lingers rather than vanishing under the pointer').toBeVisible();
  await expect(overview).toBeHidden({ timeout: 4000 });

  const linger = await page.evaluate(() => window.__mig.popup.POPUP);
  expect(linger.LINGER, 'the overview leaves at the shared pace').toBe(500);
});

test('the overview carries the same controls and keeps itself open when held', async ({ page }) => {
  await open2d(page);
  const overview = page.locator('#loader-overview');
  await page.locator('#view-loader').hover();
  await expect(overview.locator('.popup-chrome .popup-button')).toHaveText(CONTROLS);

  await overview.locator('.popup-maximize').click();
  await expect(overview).toHaveClass(/popup-maximized/);
  // A maximized popup covers the window, so the pointer can only leave it at
  // the very edge; hovering anything beneath it is impossible by design.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await expect(overview, 'a held popup does not fade out from under the reader').toBeVisible();

  await overview.locator('.popup-maximize').click();
  await overview.locator('.popup-close').click();
  await expect(overview).toBeHidden();
});

test('a popup waits for the pointer to rest, and a click opens it at once', async ({ page }) => {
  await open2d(page);
  const heads = page.locator('table.bond-matrix tbody th[data-role-name]');
  await expect.poll(() => heads.count(), { timeout: 60000 }).toBeGreaterThan(1);
  const role = await heads.first().getAttribute('data-role-name');
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  const box = await heads.first().boundingBox();

  await page.mouse.move(box.x + 5, box.y + 5);
  await page.waitForTimeout(150);
  await expect(card, 'passing over a trigger opens nothing').toHaveCount(0);
  await page.mouse.move(box.x + 6, box.y + 6);
  await expect(card, 'resting on it does').toBeVisible({ timeout: 60000 });

  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0, { timeout: 4000 });
  await heads.first().click();
  await expect(card, 'a click skips the wait').toBeVisible({ timeout: 2000 });

  const timings = await page.evaluate(() => window.__mig.popup.POPUP);
  expect(timings, 'one set of timings for every popup').toEqual({ DELAY: 300, LINGER: 500, FADE: 500 });
});

test('the card opens in the corner the pointer touched', async ({ page }) => {
  await open2d(page);
  const heads = page.locator('table.bond-matrix tbody th[data-role-name]');
  await expect.poll(() => heads.count(), { timeout: 60000 }).toBeGreaterThan(1);
  const role = await heads.first().getAttribute('data-role-name');
  const box = await heads.first().boundingBox();
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 1, at.y + 1);
  const card = page.locator(`.role-card-host[data-role="${role}"]`);
  await expect(card).toBeVisible({ timeout: 60000 });

  const placed = await card.boundingBox();
  expect(placed.x - at.x, 'the left edge sits on the pointer, clear of it by a hair')
    .toBeGreaterThan(0);
  expect(placed.x - at.x).toBeLessThanOrEqual(8);
  expect(placed.y - at.y, 'and so does the top edge').toBeGreaterThan(0);
  expect(placed.y - at.y).toBeLessThanOrEqual(8);

  await page.mouse.move(at.x + 30, at.y + 4);
  await page.waitForTimeout(400);
  const again = await card.boundingBox();
  expect(again.x, 'moving inside the trigger leaves the card where it opened').toBe(placed.x);
});

test('a card, the overview and a matrix panel share one chrome', async ({ page }) => {
  await open2d(page);
  const role = await hoverRoleWithDependencies(page);
  await expect(page.locator(`.role-card-host[data-role="${role}"] .popup-chrome .popup-button`))
    .toHaveText(CONTROLS, { timeout: 60000 });

  await page.locator('#view-loader').hover();
  await expect(page.locator('#loader-overview .popup-chrome .popup-button')).toHaveText(CONTROLS);

  await page.evaluate(() => window.__mig.matrixView.panels
    .detail({ name: 'probe', variant: null }, 'role', 60, 60));
  const panel = page.locator('.matrix-detail');
  await expect(panel.locator('.popup-chrome .popup-button')).toHaveText(CONTROLS);
  await panel.locator('.popup-close').click();
  await expect(panel).toHaveCount(0);
});
