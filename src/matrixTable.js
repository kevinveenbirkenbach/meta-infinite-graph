class MatrixTable {
  static CHIPS = 6;

  constructor(matrix) {
    this.matrix = matrix;
  }

  width(id) {
    if (this.matrix.widths[id]) return this.matrix.widths[id];
    if (id === 'role') return 200;
    if (id === 'variant') return 70;
    return MatrixModel.computed(id) ? 110 : 180;
  }

  // Returns: the rows drawn, after the search and in the current order.
  render(host, note) {
    const { model, sort, density } = this.matrix;
    const columns = this.matrix.visible();
    const rows = model.rows(columns, this.matrix.find, sort);
    const table = el('table', { className: `table table-sm role-matrix density-${density}` });
    const colgroup = table.appendChild(document.createElement('colgroup'));
    for (const id of columns) {
      const col = colgroup.appendChild(document.createElement('col'));
      col.dataset.column = id;
      col.style.width = `${this.width(id)}px`;
    }
    MatrixTable.fit(table);

    const head = table.createTHead();
    const groups = head.insertRow();
    groups.className = 'matrix-groups';
    let last = null;
    for (const id of columns) {
      const group = MatrixModel.parent(id) || (id.includes('.') ? id.split('.')[0] : '');
      if (last && last.dataset.group === group && group) {
        last.colSpan += 1;
        continue;
      }
      last = groups.appendChild(el('th', { textContent: group }));
      last.dataset.group = group;
    }
    const keys = head.insertRow();
    keys.className = 'matrix-keys';
    for (const id of columns) keys.appendChild(this._head(id, rows));

    const body = table.createTBody();
    for (const row of rows) {
      const line = body.insertRow();
      for (const id of columns) line.appendChild(this._cell(row, id));
    }

    host.innerHTML = '';
    host.appendChild(table);
    const total = model.allRows().length;
    note.textContent = `${rows.length}${rows.length === total ? '' : ` of ${total}`} rows, `
      + `${columns.length} of ${model.catalogue(this.matrix.columns).length} columns. Click a `
      + 'heading to sort, shift-click to sort by more than one; drag it to move it, drag its '
      + 'edge to widen it; click a value to read all of it, click a role to pin its card.';
    return rows;
  }

  _head(id, rows) {
    const { model, sort } = this.matrix;
    const th = el('th', { title: id });
    th.dataset.column = id;
    const leaf = MatrixModel.computed(id) ? id.split('.').slice(1).join('.') : id.split('.').pop();

    const { common, rare } = model.children(id, rows);
    if (common.length || rare.length) {
      const unfold = el('span', {
        className: 'matrix-unfold', textContent: '▸',
        title: `Unfold ${id} into its ${common.length} common keys`,
      });
      unfold.addEventListener('click', event => {
        event.stopPropagation();
        this.matrix.expand(id, !common.length);
      });
      th.appendChild(unfold);
    }
    th.appendChild(el('span', { className: 'matrix-label', textContent: leaf }));

    const at = sort.findIndex(key => key.id === id);
    if (at >= 0) {
      const { dir } = sort[at];
      th.appendChild(el('span', {
        className: 'matrix-sorted',
        textContent: `${dir === 'asc' ? '▲' : '▼'}${sort.length > 1 ? at + 1 : ''}`,
      }));
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    }

    if (id !== 'role' && id !== 'variant' && rows.length) {
      const filled = rows.filter(row => !MatrixModel.empty(model.value(row, id))).length;
      th.appendChild(el('span', {
        className: 'matrix-fill', textContent: `${Math.round((filled / rows.length) * 100)}%`,
        title: `${filled} of ${rows.length} rows carry a value`,
      }));
    }

    if (id === 'variant') return th;

    const more = el('button', {
      type: 'button', className: 'matrix-more', textContent: '⋮', title: 'Column menu',
    });
    more.addEventListener('click', event => {
      event.stopPropagation();
      const box = more.getBoundingClientRect();
      this.matrix.panels.menu(id, box.left, box.bottom, rows);
    });
    th.appendChild(more);

    const grip = el('span', { className: 'matrix-resize', title: 'Drag to widen' });
    grip.addEventListener('mousedown', event => MatrixPointer.widen(this.matrix, event, id, th));
    grip.addEventListener('click', event => event.stopPropagation());
    th.appendChild(grip);

    th.addEventListener('mousedown', event => MatrixPointer.press(this.matrix, event, id));
    th.addEventListener('contextmenu', event => {
      event.preventDefault();
      this.matrix.panels.menu(id, event.clientX, event.clientY, rows);
    });
    return th;
  }

  // A fixed table spreads any width beyond its columns over all of them, and
  // max-content would measure every unbroken description; only an explicit sum
  // leaves each column the width it was given.
  static fit(table) {
    const cols = [...table.querySelectorAll('col')];
    table.style.width = `${cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0)}px`;
  }

  static _chips(items, make) {
    const cell = el('td', { className: 'matrix-chips' });
    for (const item of items.slice(0, MatrixTable.CHIPS)) cell.appendChild(make(item));
    if (items.length > MatrixTable.CHIPS) {
      cell.appendChild(el('span', {
        className: 'chip matrix-more-chips', textContent: `+${items.length - MatrixTable.CHIPS}`,
      }));
    }
    return cell;
  }

  _cell(row, id) {
    const { model, tableView, cards } = this.matrix;
    const value = model.value(row, id);
    if (id === 'role') {
      const cell = tableView._roleCell(row.name);
      cell.classList.add('matrix-role');
      cell.addEventListener('click', () => {
        const box = cell.getBoundingClientRect();
        cards.pin(row.name, () => ({ x: box.right, y: box.top }));
      });
      return cell;
    }
    if (id === 'variant') return TableView._cell(TableView._fmtVariant(value), 'num');
    if (MatrixModel.empty(value)) return TableView._cell('·', 'matrix-empty');

    let cell;
    if (id === 'complexity.siblings') {
      cell = tableView._roleListCell(value);
    } else if (typeof value === 'boolean') {
      cell = tableView._boolCell(value);
    } else if (id in MatrixModel.RESSOURCES || typeof value === 'number') {
      cell = TableView._cell(model.display(row, id), 'num');
    } else if (id === 'services' && MatrixModel.isMap(value)) {
      cell = MatrixTable._chips(Object.keys(value), key => tableView.roleInfo.serviceChip(key));
    } else if (id === 'main.dependencies' && Array.isArray(value)) {
      cell = MatrixTable._chips(value.map(String), role => {
        const chip = el('span', { className: 'chip service', textContent: role });
        chip.dataset.roleName = role;
        return chip;
      });
    } else if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
      cell = MatrixTable._chips(value.map(String), item => el('span', { className: 'chip', textContent: item }));
    } else {
      cell = TableView._cell(MatrixModel.text(value), 'matrix-text');
      cell.title = cell.textContent;
    }
    cell.classList.add('matrix-value');
    cell.addEventListener('click', event => {
      if (event.target.closest('[data-role-name]')) return;
      const structured = value !== null && typeof value === 'object';
      if (!structured && cell.scrollWidth <= cell.clientWidth) return;
      this.matrix.panels.detail(row, id, event.clientX, event.clientY);
    });
    return cell;
  }
}

window.MatrixTable = MatrixTable;
