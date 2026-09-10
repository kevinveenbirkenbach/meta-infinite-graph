const { expect } = require('@playwright/test');

const DEFAULT = [
  'role', 'complexity.lifecycle', 'main.galaxy_info.description',
  'main.galaxy_info.galaxy_tags', 'services', 'main.dependencies', 'complexity.weight',
  'complexity.consumers', 'ressources.cpus', 'ressources.mem_limit', 'info.homepage', 'variants',
];

// Every meta/*.yml of every role is read on the first visit, which takes far
// longer than the default expect timeout on a loaded suite.
async function openMatrix(page, query = '') {
  await page.goto(`/?view=matrix${query}`);
  const rows = page.locator('table.role-matrix tbody tr');
  await expect.poll(() => rows.count(), { timeout: 120000 }).toBeGreaterThan(0);
  return rows;
}

const keys = page => page.locator('table.role-matrix thead tr.matrix-keys th');
const head = (page, id) => page.locator(`table.role-matrix thead tr.matrix-keys th[data-column="${id}"]`);
const heads = page => keys(page).evaluateAll(cells => cells.map(cell => cell.dataset.column));

const column = (page, id) => page.locator('table.role-matrix tbody tr')
  .evaluateAll((lines, wanted) => {
    const index = [...document.querySelectorAll('table.role-matrix thead tr.matrix-keys th')]
      .findIndex(cell => cell.dataset.column === wanted);
    return lines.map(line => line.cells[index].textContent);
  }, id);

const numbers = texts => texts.filter(text => text !== '·').map(Number);

module.exports = { DEFAULT, openMatrix, head, heads, column, numbers };
