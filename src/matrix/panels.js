class MatrixPanels {
  constructor(matrix) {
    this.matrix = matrix;
    this.picked = null;
    this._outside = null;
    this._escape = null;
  }

  _float(className, x, y) {
    this.close();
    const panel = el('div', { className: `${className} matrix-float` });
    document.body.appendChild(panel);
    const place = () => {
      const box = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    };
    this._outside = event => {
      if (!panel.contains(event.target)) this.close();
    };
    this._escape = event => {
      if (event.key === 'Escape') this.close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._outside);
      document.addEventListener('keydown', this._escape);
    });
    return { panel, place };
  }

  close() {
    this.picked = null;
    for (const open of document.querySelectorAll('.matrix-float')) open.remove();
    if (this._outside) document.removeEventListener('mousedown', this._outside);
    if (this._escape) document.removeEventListener('keydown', this._escape);
    this._outside = null;
    this._escape = null;
  }

  detail(row, id, x, y) {
    const { panel, place } = this._float('matrix-detail', x, y);
    const variant = row.variant !== null && row.variant !== undefined ? ` #${row.variant}` : '';
    panel.appendChild(el('div', {
      className: 'matrix-detail-title', textContent: `${row.name}${variant} · ${id}`,
    }));
    const value = this.matrix.model.value(row, id);
    panel.appendChild(el('pre', {
      textContent: typeof value === 'object' && value !== null
        ? jsyaml.dump(value, { lineWidth: 100 }).trimEnd()
        : String(value),
    }));
    place();
  }

  menu(id, x, y, rows) {
    const { matrix } = this;
    const { panel, place } = this._float('matrix-menu dropdown-menu show', x, y);
    const item = (into, text, action, disabled) => {
      const button = el('button', {
        type: 'button', className: 'dropdown-item', textContent: text, disabled,
      });
      button.addEventListener('click', () => {
        this.close();
        action();
      });
      into.appendChild(button);
    };
    item(panel, 'Sort ascending', () => matrix.setSort(id, 'asc'), false);
    item(panel, 'Sort descending', () => matrix.setSort(id, 'desc'), false);
    const { common, rare } = matrix.model.children(id, rows);
    item(panel, `Unfold into ${common.length} common columns`, () => matrix.expand(id, false),
      !common.length);
    if (rare.length) {
      item(panel, `Unfold all ${common.length + rare.length} (${rare.length} rare)`,
        () => matrix.expand(id, true), false);
    }
    const parent = MatrixModel.parent(id);
    item(panel, `Fold into ${parent || 'its parent'}`, () => matrix.collapse(id), !parent);
    item(panel, 'Remove this column', () => matrix.remove(id), id === 'role');

    panel.appendChild(el('div', { className: 'dropdown-divider' }));
    const search = el('input', {
      type: 'search', className: 'form-control form-control-sm', placeholder: 'Add a column …',
    });
    const list = el('div', { className: 'matrix-menu-list' });
    const fill = () => {
      list.innerHTML = '';
      const hidden = matrix.model.search(search.value, matrix.columns)
        .filter(column => !matrix.columns.includes(column));
      for (const column of hidden.slice(0, 80)) {
        item(list, column, () => matrix.add(column, id), false);
      }
      if (hidden.length > 80) {
        list.appendChild(el('div', {
          className: 'dropdown-item-text small', textContent: `${hidden.length - 80} more, type to narrow`,
        }));
      }
    };
    search.addEventListener('input', fill);
    panel.append(search, list);
    fill();
    place();
  }

  picker(x, y) {
    const { panel, place } = this._float('matrix-picker', x, y);
    const search = el('input', {
      type: 'search', className: 'form-control form-control-sm', placeholder: 'Filter columns …',
    });
    const reset = el('button', {
      type: 'button', className: 'btn btn-sm btn-outline-primary', textContent: 'Default',
    });
    reset.addEventListener('click', () => this.matrix.setColumns([...MatrixModel.DEFAULT]));
    const top = el('div', { className: 'd-flex gap-1 mb-1' });
    top.append(search, reset);
    const list = el('div', { className: 'matrix-columns' });
    panel.append(top, list);
    search.addEventListener('input', () => this.list(list, search.value));
    this.list(list, '');
    place();
    this.picked = { list, search };
    search.focus();
  }

  // Args:
  //   host: the element to fill; the design panel's list and the popover at the
  //     table both render through here.
  //   needle: narrows the list to columns whose path contains it.
  list(host, needle) {
    const { matrix } = this;
    if (!host) return;
    if (!matrix.model.meta) {
      host.textContent = 'Open the matrix once to list its columns.';
      return;
    }
    host.innerHTML = '';
    const groups = new Map();
    for (const id of matrix.model.search(needle, matrix.columns)) {
      const group = id.split('.')[0];
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(id);
    }
    for (const [group, ids] of groups) {
      host.appendChild(el('div', { className: 'matrix-columns-group', textContent: group }));
      for (const id of ids) {
        const row = el('label', { className: 'matrix-columns-row' });
        const box = el('input', {
          type: 'checkbox', checked: matrix.columns.includes(id), disabled: id === 'role',
        });
        box.dataset.column = id;
        box.addEventListener('change', () => (box.checked ? matrix.add(id) : matrix.remove(id)));
        row.append(box, ` ${id}`);
        if (id !== 'role' && matrix.model.distinct(id) <= 1) {
          row.appendChild(el('span', {
            className: 'matrix-const', textContent: 'constant',
            title: 'Every role carries the same value here',
          }));
        }
        host.appendChild(row);
      }
    }
  }

  // Returns: the lines written, header first.
  download() {
    const { matrix } = this;
    const columns = matrix.visible();
    const rows = matrix.model.rows(columns, matrix.find, matrix.sort);
    const quote = text => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const lines = [columns.map(quote).join(',')];
    for (const row of rows) {
      lines.push(columns.map(id => quote(matrix.model.display(row, id))).join(','));
    }
    const link = el('a', {
      href: URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })),
      download: 'mig-matrix.csv',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href));
    return lines;
  }
}

window.MatrixPanels = MatrixPanels;
