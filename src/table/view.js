class TableView extends TableCells {
  constructor(metaTables, container, roleInfo) {
    super(roleInfo);
    this.tables = metaTables;
    this.container = container;
    this.kind = 'bond';
    this.variantAware = false;
    this.filters = { author: '', lifecycle: '', mode: '' };
    this._cache = {};
  }

  setFilters(filters) {
    this.filters = filters;
    this._cache = {};
  }

  _keeps(role) {
    return this.roleInfo.graph.matches(role, this.filters);
  }

  show(kind) {
    if (kind === 'matrix') return this.matrix.show();
    this.kind = kind;
    const key = `${kind}|${this.variantAware}|${this.roleInfo.symbols}`;
    this.container.innerHTML = '';
    if (!this._cache[key]) {
      this._cache[key] = this[`_build${kind[0].toUpperCase()}${kind.slice(1)}`]();
    }
    this.container.appendChild(this._cache[key]);
  }

  refresh() {
    this.show(this.kind);
  }

  _buildBond() {
    const edges = this.tables.bondEdges();
    const participants = MetaTables.bondParticipants(edges).filter(role => this._keeps(role));
    const axis = this.variantAware
      ? this.tables.variantAxis(participants)
      : participants.map(role => ({ role, variant: null }));
    const bonds = this.variantAware
      ? axis.map(entry => this.tables.bondsOf(entry.role, entry.variant))
      : null;

    const table = document.createElement('table');
    table.className = this.roleInfo.symbols ? 'bond-matrix symbols' : 'bond-matrix';
    const thead = document.createElement('thead');

    if (this.variantAware) {
      const variantRow = document.createElement('tr');
      variantRow.appendChild(TableView._corner(2));
      axis.forEach((entry, index) => {
        const th = document.createElement('th');
        th.className = 'variant-head';
        th.dataset.col = String(index + 1);
        th.textContent = TableView._fmtVariant(entry.variant);
        variantRow.appendChild(th);
      });
      thead.appendChild(variantRow);
    }

    const roleRow = document.createElement('tr');
    roleRow.appendChild(TableView._corner(this.variantAware ? 2 : 1));
    axis.forEach((entry, index) => {
      const th = document.createElement('th');
      th.dataset.col = String(index + 1);
      th.dataset.roleName = entry.role;
      const label = document.createElement('div');
      label.appendChild(this.roleInfo.label(entry.role));
      th.appendChild(label);
      roleRow.appendChild(th);
    });
    thead.appendChild(roleRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    axis.forEach((rowEntry, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.row = String(rowIndex);
      if (this.variantAware) {
        const variantHead = document.createElement('th');
        variantHead.className = 'variant-head';
        variantHead.dataset.col = '0';
        variantHead.textContent = TableView._fmtVariant(rowEntry.variant);
        tr.appendChild(variantHead);
      }
      const rowHead = this._roleCell(rowEntry.role, 'th');
      rowHead.dataset.col = '0';
      tr.appendChild(rowHead);

      axis.forEach((colEntry, colIndex) => {
        const td = document.createElement('td');
        td.dataset.col = String(colIndex + 1);
        if (rowEntry.role === colEntry.role) {
          td.className = 'diag';
        } else if (this.variantAware) {
          td.appendChild(TableView._bar(
            bonds[rowIndex].get(colEntry.role), rowEntry.role, colEntry.role
          ));
          td.appendChild(TableView._bar(
            bonds[colIndex].get(rowEntry.role), colEntry.role, rowEntry.role
          ));
        } else {
          td.appendChild(TableView._bar(
            edges.get(`${rowEntry.role}|${colEntry.role}`), rowEntry.role, colEntry.role
          ));
          td.appendChild(TableView._bar(
            edges.get(`${colEntry.role}|${rowEntry.role}`), colEntry.role, rowEntry.role
          ));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const scope = this.variantAware
      ? `${axis.length} variants of ${participants.length} roles. A bond only counts `
        + 'where the variant enables it, so a row shows what that variant deploys. '
      : `${edges.size} bonds across ${participants.length} roles. `;
    const section = this._wrap(
      'Bond matrix',
      `${scope}Row to column above, column to row below. A bond of 0 is the page, `
      + '1 is its opposite. Hover crosses the pair in yellow, a click locks it in '
      + 'violet until the next click. Read only; run the infinito bond CLI to edit.',
      table
    );
    section.appendChild(TableView._crosshair(table));
    return section;
  }

  static _corner(span) {
    const th = document.createElement('th');
    th.className = 'corner';
    if (span > 1) th.colSpan = span;
    return th;
  }

  static _crosshair(table) {
    const style = document.createElement('style');
    let hovered = null;
    let locked = null;

    const paint = () => {
      const rules = [];
      const add = (target, variable) => {
        if (!target) return;
        const selectors = [`table.bond-matrix [data-col="${target.col}"]`];
        if (target.row !== null) {
          selectors.push(`table.bond-matrix tr[data-row="${target.row}"] > *`);
        }
        rules.push(`${selectors.join(',')} { background: var(${variable}); }`);
        rules.push(
          `${selectors.map(s => `${s} > span`).join(',')} `
          + `{ box-shadow: inset 0 0 0 2px var(${variable}); }`
        );
      };
      add(hovered, '--bond-hover');
      add(locked, '--bond-lock');
      style.textContent = rules.join('\n');
    };

    const locate = event => {
      const cell = event.target.closest('td, th');
      if (!cell || !table.contains(cell)) return null;
      const row = cell.parentElement.dataset.row;
      return { col: cell.dataset.col, row: row === undefined ? null : row };
    };

    table.addEventListener('mousemove', event => {
      const target = locate(event);
      if (target && (!hovered || hovered.col !== target.col || hovered.row !== target.row)) {
        hovered = target;
        paint();
      }
    });

    table.addEventListener('mouseleave', () => {
      hovered = null;
      paint();
    });

    table.addEventListener('click', event => {
      const target = locate(event);
      if (!target) return;
      const same = locked && locked.col === target.col && locked.row === target.row;
      locked = same ? null : target;
      paint();
    });

    return style;
  }

  static _bar(edge, consumer, provider) {
    const span = document.createElement('span');
    if (!edge) {
      span.className = 'nb';
      return span;
    }
    span.className = 'b';
    span.style.setProperty('--b', String(Math.max(0, Math.min(1, edge.bond))));
    span.textContent = String(edge.bond);
    span.title = `${consumer} -> ${provider} via ${edge.serviceKey}`;
    return span;
  }
}

window.TableView = TableView;
