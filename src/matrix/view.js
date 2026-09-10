import { byId, el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { MatrixModel } from './model.js';
import { MatrixPanels } from './panels.js';
import { MatrixTable } from './table.js';
import { MatrixToolbar } from './toolbar.js';

export class MatrixView {
  static WIDTHS_KEY = 'mig-matrix-widths';

  // Args:
  //   tableView: the TableView whose filters, variant switch and cell helpers apply.
  //   loader: reads the meta/ files, once, the first time the matrix is shown.
  //   onChange: called after columns, order, search or density changed.
  //   cards: the RoleCardHost a role cell pins its card to.
  constructor(tableView, loader, container, onChange, cards) {
    this.tableView = tableView;
    this.container = container;
    this.onChange = onChange;
    this.cards = cards;
    this.model = new MatrixModel(tableView, loader);
    this.table = new MatrixTable(this);
    this.panels = new MatrixPanels(this);
    this.toolbar = new MatrixToolbar(this);
    this.columns = [...MatrixModel.DEFAULT];
    this.sort = [{ id: 'role', dir: 'asc' }];
    this.complexity = false;
    this.find = '';
    this.density = 'compact';
    this.widths = MatrixView._readWidths();
    this.root = el('div', { className: 'table-section matrix-section' });
  }

  get meta() {
    return this.model.meta;
  }

  distinct(id) {
    return this.model.distinct(id);
  }

  download() {
    return this.panels.download();
  }

  renderPicker(host, needle) {
    this.panels.list(host, needle);
  }

  static _readWidths() {
    try {
      return JSON.parse(localStorage.getItem(MatrixView.WIDTHS_KEY)) || {};
    } catch {
      return {};
    }
  }

  saveWidths() {
    try {
      localStorage.setItem(MatrixView.WIDTHS_KEY, JSON.stringify(this.widths));
    } catch {
      // A blocked store only costs the widths their persistence.
    }
  }

  visible() {
    return this.tableView.variantAware
      ? ['role', 'variant', ...this.columns.filter(id => id !== 'role')]
      : this.columns;
  }

  setColumns(next) {
    this.columns = [...new Set(['role', ...next.filter(id => id !== 'role')])];
    this._changed();
  }

  add(id, after) {
    if (this.columns.includes(id)) return;
    const next = [...this.columns];
    const at = after ? next.indexOf(after) + 1 : next.length;
    next.splice(at > 0 ? at : next.length, 0, id);
    this.setColumns(next);
  }

  remove(id) {
    if (id === 'role') return;
    this.sort = this.sort.filter(key => key.id !== id);
    if (!this.sort.length) this.sort = [{ id: 'role', dir: 'asc' }];
    this.setColumns(this.columns.filter(column => column !== id));
  }

  move(id, before) {
    if (id === 'role' || id === before) return;
    const next = this.columns.filter(column => column !== id);
    const at = next.indexOf(before);
    next.splice(at < 1 ? 1 : at, 0, id);
    this.setColumns(next);
  }

  expand(id, all) {
    const { common, rare } = this.model.children(id, this.model.allRows());
    const children = (all ? [...common, ...rare] : common)
      .filter(child => !this.columns.includes(child));
    if (!children.length) return;
    const next = [...this.columns];
    next.splice(next.indexOf(id), 1, ...children);
    this.setColumns(next);
  }

  collapse(id) {
    const parent = MatrixModel.parent(id);
    if (!parent) return;
    const next = [];
    for (const column of this.columns) {
      if (column === parent || column.startsWith(`${parent}.`)) {
        if (!next.includes(parent)) next.push(parent);
      } else {
        next.push(column);
      }
    }
    this.setColumns(next);
  }

  // Args:
  //   additive: true keeps the keys already sorted by and adds or flips this one.
  sortBy(id, additive) {
    const at = this.sort.findIndex(key => key.id === id);
    if (additive) {
      if (at >= 0) this.sort[at].dir = this.sort[at].dir === 'asc' ? 'desc' : 'asc';
      else this.sort.push({ id, dir: 'asc' });
    } else {
      const dir = at === 0 && this.sort[0].dir === 'asc' ? 'desc' : 'asc';
      this.sort = [{ id, dir }];
    }
    this._changed();
  }

  setSort(id, dir) {
    this.sort = [{ id, dir }];
    this._changed();
  }

  setComplexity(on) {
    this.complexity = on;
    if (on) {
      this.columns = [...new Set([...this.columns, ...MatrixModel.COMPLEXITY])];
      this.sort = [{ id: 'complexity.weight', dir: 'desc' }];
    } else {
      this.columns = this.columns.filter(id => !MatrixModel.COMPLEXITY.includes(id)
        || MatrixModel.DEFAULT.includes(id));
      this.sort = [{ id: 'role', dir: 'asc' }];
    }
    this._changed();
  }

  preset(name) {
    this.complexity = false;
    this.sort = [{ id: 'role', dir: 'asc' }];
    this.setColumns([...MatrixModel.PRESETS[name].columns]);
  }

  setFind(text) {
    this.find = text;
    if (this.onChange) this.onChange(this);
    if (this.model.meta) this.paint();
  }

  setDensity(density) {
    this.density = density;
    this._changed();
  }

  _changed() {
    if (this.onChange) this.onChange(this);
    if (this.model.meta) this.paint();
    this.panels.list(
      document.getElementById('matrix-columns'),
      (byId('matrix-columns-search', HTMLInputElement) || {}).value || ''
    );
    this.panels.repaintPicker();
  }

  // Returns: the rows drawn, after the search and in the current order.
  paint() {
    const columns = this.visible();
    const rows = this.model.rows(columns, this.find, this.sort);
    render(html`
      <h2>${t('view.matrix')}</h2>
      ${this.toolbar.render()}
      <p class="table-note">${this.table.note(rows, columns)}</p>
      <div class="matrix-host">${this.table.grid(rows, columns)}</div>
    `, this.root);
    return rows;
  }

  show() {
    this.tableView.kind = 'matrix';
    this.panels.close();
    this.container.replaceChildren(this.root);
    if (!this.model.meta) {
      render(html`<p class="table-note">${t('matrix.reading')}</p>`, this.root);
      return this.model.load().then(() => {
        this.panels.list(document.getElementById('matrix-columns'), '');
        if (this.tableView.kind === 'matrix') this.show();
      });
    }
    return Promise.resolve(this.paint());
  }
}
