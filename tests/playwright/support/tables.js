const { expect } = require('@playwright/test');

// Bootstrap hides a .btn-check radio and puts its label on top, so the label
// is the only clickable half of the control. The Roles and Tests menus keep
// their labels hidden until their button opens them.
async function pickView(page, view) {
  const label = page.locator(`label[for="view-${view}"]`);
  const menu = await label.evaluate(el => el.closest('.view-menu')?.previousElementSibling?.id || '');
  if (menu && !(await label.isVisible())) await page.locator(`#${menu}`).click();
  await label.click();
}

async function open2d(page, view = 'bond') {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__mig?.tableView)))
    .toBe(true);
  await pickView(page, view);
  // The switch renders the table, and a row grabbed mid-render is replaced by
  // the one that follows, which loses whatever the caller hovered.
  await expect
    .poll(() => page.locator('#tables table tbody tr').count(), { timeout: 60000 })
    .toBeGreaterThan(0);
}

async function openFilters(page) {
  if (await page.locator('#sidebar').isHidden()) {
    await page.locator('#btn-filter').click();
  }
  await expect(page.locator('#sidebar')).toBeVisible();
}

async function openDesign(page) {
  if (await page.locator('#design-panel').isHidden()) {
    await page.locator('#btn-design').click();
  }
  await expect(page.locator('#design-panel')).toBeVisible();
}

// A role whose ressources span several services and reach into a shared
// dependency, so the breakdown has something to break down.
async function hoverRoleWithDependencies(page) {
  const role = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('table.bond-matrix tbody th[data-role-name]')];
    const tables = window.__mig.tableView.tables;
    const hit = heads.map(th => th.dataset.roleName).find(name => {
      const { rows } = tables.resourcesOf(name);
      return rows.length > 1 && rows.some(row => row.depth > 1);
    });
    return hit || null;
  });
  expect(role, 'the fixture tree has a role with shared dependencies').not.toBe(null);
  await page.locator(`table.bond-matrix tbody th[data-role-name="${role}"]`).first().hover();
  return role;
}

module.exports = { pickView, open2d, openFilters, openDesign, hoverRoleWithDependencies };
