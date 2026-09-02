class TableView {
  constructor(metaTables, container, roleInfo) {
    this.tables = metaTables;
    this.container = container;
    this.roleInfo = roleInfo;
    this.kind = 'bond';
    this._cache = {};
  }

  static _fmtBytes(value) {
    if (value === null || value === undefined) return '-';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
      size /= 1000;
      unit += 1;
    }
    const rounded = Math.round(size * 100) / 100;
    return `${rounded} ${units[unit]}`;
  }

  static _fmtNumber(value) {
    return value === null || value === undefined ? '-' : String(value);
  }

  static _cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  _roleCell(role, tag = 'td') {
    const cell = document.createElement(tag);
    cell.dataset.roleName = role;
    cell.appendChild(this.roleInfo.label(role));
    return cell;
  }

  _roleListCell(roles) {
    const cell = document.createElement('td');
    if (!roles.length) {
      cell.textContent = '-';
      return cell;
    }
    cell.className = 'role-list';
    roles.forEach((role, index) => {
      const item = document.createElement('span');
      item.dataset.roleName = role;
      item.appendChild(this.roleInfo.label(role));
      cell.appendChild(item);
      if (!this.roleInfo.symbols && index < roles.length - 1) {
        cell.appendChild(document.createTextNode(', '));
      }
    });
    return cell;
  }

  _boolCell(value) {
    const cell = document.createElement('td');
    if (!this.roleInfo.symbols) {
      cell.textContent = value ? 'yes' : 'no';
      return cell;
    }
    const icon = document.createElement('i');
    icon.className = value ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
    cell.title = value ? 'yes' : 'no';
    cell.className = 'bool';
    cell.appendChild(icon);
    return cell;
  }

  static _headRow(labels) {
    const tr = document.createElement('tr');
    for (const label of labels) {
      const th = document.createElement('th');
      th.textContent = label;
      tr.appendChild(th);
    }
    const thead = document.createElement('thead');
    thead.appendChild(tr);
    return thead;
  }

  show(kind) {
    this.kind = kind;
    const key = `${kind}|${this.roleInfo.symbols}`;
    this.container.innerHTML = '';
    if (!this._cache[key]) {
      this._cache[key] = this[`_build${kind[0].toUpperCase()}${kind.slice(1)}`]();
    }
    this.container.appendChild(this._cache[key]);
  }

  refresh() {
    this.show(this.kind);
  }

  _wrap(title, note, table) {
    const section = document.createElement('div');
    section.className = 'table-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const caption = document.createElement('p');
    caption.className = 'table-note';
    caption.textContent = note;
    const scroller = document.createElement('div');
    scroller.className = 'table-scroll';
    scroller.appendChild(table);
    section.append(heading, caption, scroller);
    return section;
  }

  _buildBond() {
    const edges = this.tables.bondEdges();
    const roles = MetaTables.bondParticipants(edges);
    const table = document.createElement('table');
    table.className = this.roleInfo.symbols ? 'bond-matrix symbols' : 'bond-matrix';

    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.dataset.col = '0';
    headRow.appendChild(corner);
    roles.forEach((role, index) => {
      const th = document.createElement('th');
      th.dataset.col = String(index + 1);
      th.dataset.roleName = role;
      const label = document.createElement('div');
      label.appendChild(this.roleInfo.label(role));
      th.appendChild(label);
      headRow.appendChild(th);
    });
    const thead = document.createElement('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    roles.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.row = String(rowIndex);
      const rowHead = this._roleCell(row, 'th');
      rowHead.dataset.col = '0';
      tr.appendChild(rowHead);
      roles.forEach((col, colIndex) => {
        const td = document.createElement('td');
        td.dataset.col = String(colIndex + 1);
        if (row === col) {
          td.className = 'diag';
        } else {
          td.appendChild(TableView._bar(edges.get(`${row}|${col}`), row, col));
          td.appendChild(TableView._bar(edges.get(`${col}|${row}`), col, row));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const section = this._wrap(
      'Bond matrix',
      `${edges.size} bonds across ${roles.length} roles. Row to column above, `
      + 'column to row below. A bond of 0 is the page, 1 is its opposite. '
      + 'Hover crosses the pair in yellow, a click locks it in violet until the '
      + 'next click. Read only; run the infinito bond CLI to edit.',
      table
    );
    section.appendChild(TableView._crosshair(table));
    return section;
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

  _buildRessources() {
    const rows = this.tables.resourceRows();
    const table = document.createElement('table');
    table.className = 'table table-sm table-striped';
    table.appendChild(TableView._headRow([
      'role', 'services', 'mem_reservation', 'mem_limit', 'min_storage', 'pids_limit', 'cpus',
    ]));
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.append(
        this._roleCell(row.role),
        TableView._cell(String(row.services), 'num'),
        TableView._cell(TableView._fmtBytes(row.mem_reservation_bytes), 'num'),
        TableView._cell(TableView._fmtBytes(row.mem_limit_bytes), 'num'),
        TableView._cell(TableView._fmtBytes(row.min_storage_bytes), 'num'),
        TableView._cell(TableView._fmtNumber(row.pids_limit_int), 'num'),
        TableView._cell(TableView._fmtNumber(row.cpus_float), 'num')
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return this._wrap(
      'Resource footprint per role',
      `${rows.length} application roles, base config, shared dependencies resolved `
      + 'recursively. mem and pids are summed, cpus is the maximum. The CLI shows the '
      + 'heaviest meta/variants.yml variant instead; variants are not read here.',
      table
    );
  }

  _buildComplexity() {
    const rows = this.tables.complexityRows()
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
    const table = document.createElement('table');
    table.className = 'table table-sm table-striped';
    table.appendChild(TableView._headRow([
      'role', 'lifecycle', 'embeds', 'consumers', 'embeds_direct', 'consumers_direct',
      'weight', 'integrated', 'clone', 'siblings',
    ]));
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.append(
        this._roleCell(row.name),
        TableView._cell(row.lifecycle || '-'),
        TableView._cell(String(row.embeds), 'num'),
        TableView._cell(String(row.consumers), 'num'),
        TableView._cell(String(row.embeds_direct), 'num'),
        TableView._cell(String(row.consumers_direct), 'num'),
        TableView._cell(String(row.weight), 'num'),
        this._boolCell(row.integrated),
        this._boolCell(row.clone),
        this._roleListCell(row.siblings)
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return this._wrap(
      'Complexity',
      `${rows.length} application roles, heaviest first. The CI columns the CLI adds `
      + '(compose, swarm, host, stack, test_*, variants, in_main) need the git history, '
      + 'default.env and each role templates directory, none of which the browser reads.',
      table
    );
  }
}

window.TableView = TableView;
