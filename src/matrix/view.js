class MatrixView {
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
    this.host = null;
    this.note = null;
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
    this.setColumns([...MatrixModel.PRESETS[name][1]]);
  }

  setFind(text) {
    this.find = text;
    if (this.onChange) this.onChange(this);
    if (this.host) this.table.render(this.host, this.note);
  }

  setDensity(density) {
    this.density = density;
    this._changed();
  }

  // Re-renders in place: rebuilding the whole view would close the column
  // picker after every box ticked in it.
  _changed() {
    if (this.onChange) this.onChange(this);
    const bar = this.container.querySelector('.matrix-section .matrix-toolbar');
    if (bar) {
      bar.replaceWith(this.toolbar.render());
      this.table.render(this.host, this.note);
    }
    this.panels.list(
      document.getElementById('matrix-columns'),
      (document.getElementById('matrix-columns-search') || {}).value || ''
    );
    if (this.panels.picked) this.panels.list(this.panels.picked.list, this.panels.picked.search.value);
  }

  show() {
    this.tableView.kind = 'matrix';
    this.panels.close();
    this.container.innerHTML = '';
    if (!this.model.meta) {
      this.container.appendChild(el('p', {
        className: 'table-note', textContent: 'Reading every meta/*.yml …',
      }));
      return this.model.load().then(() => {
        this.panels.list(document.getElementById('matrix-columns'), '');
        if (this.tableView.kind === 'matrix') this.show();
      });
    }

    const section = el('div', { className: 'table-section matrix-section' });
    section.appendChild(el('h2', { textContent: 'Matrix' }));
    section.appendChild(this.toolbar.render());
    this.note = section.appendChild(el('p', { className: 'table-note' }));
    this.host = section.appendChild(el('div', { className: 'matrix-host' }));
    this.container.appendChild(section);
    return Promise.resolve(this.table.render(this.host, this.note));
  }
}

window.MatrixView = MatrixView;
