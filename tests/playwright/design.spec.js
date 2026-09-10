const { test, expect } = require('@playwright/test');

test('the theme follows the system and an explicit choice outlives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');

  await page.locator('#btn-design').click();
  await page.locator('#design-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light');
});

test('the design panel drives the font, the veil and nothing else', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-design').click();
  await expect(page.locator('#design-panel')).toBeVisible();

  const root = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      size: style.getPropertyValue('--mig-font-size').trim(),
      family: style.getPropertyValue('--mig-font-family').trim(),
      veil: style.getPropertyValue('--mig-veil').trim(),
    };
  });
  expect(await root()).toEqual({
    size: '14px',
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    veil: '0.05',
  });

  await page.locator('#design-font-size').fill('20');
  await page.locator('#design-font-size').dispatchEvent('input');
  await page.locator('#design-font-family').selectOption('mono');
  await page.locator('#design-opacity').fill('30');
  await page.locator('#design-opacity').dispatchEvent('input');

  const after = await root();
  expect(after.size).toBe('20px');
  expect(after.family).toContain('monospace');
  expect(after.veil).toBe('0.3');
  await expect(page.locator('#design-font-size-value')).toHaveText('20');
  await expect(page.locator('#design-opacity-value')).toHaveText('30');
});

test('the bottom navigator carries the status and the credits', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('#bottom-nav');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a[href*="github.com"]')).toHaveText(/Source/);
  await expect(nav.locator('a[href*="veen.world"]')).toHaveText(/Kevin/);
  await expect(nav).toContainText('MIT License');
  await expect(page.locator('#sidebar #status')).toHaveCount(0);
});
