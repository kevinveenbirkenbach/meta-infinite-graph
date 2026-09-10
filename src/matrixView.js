// Every value under each role's meta/, one row per role. A column is a dotted
// path; the catalogue offers one per file and top-level key, and a column
// whose values are maps unfolds into its keys.
class MatrixView {
  // Chosen by how much they tell apart: license is one value for every role
  // and author nearly so, which is why neither is here.
  static DEFAULT = [
    'role', 'complexity.lifecycle', 'main.galaxy_info.description',
    'main.galaxy_info.galaxy_tags', 'services', 'main.dependencies', 'complexity.weight',
    'complexity.consumers', 'ressources.cpus', 'ressources.mem_limit', 'info.homepage', 'variants',
  ];

  static COMPLEXITY = [
    'complexity.lifecycle', 'complexity.embeds', 'complexity.consumers',
    'complexity.embeds_direct', 'complexity.consumers_direct', 'complexity.weight',
    'complexity.integrated', 'complexity.clone', 'complexity.siblings',
  ];

  static RESSOURCES = {
    'ressources.cpus': ['cpus_float', value => TableView._fmtNumber(value)],
    'ressources.mem_reservation': ['mem_reservation_bytes', value => TableView._fmtBytes(value)],
    'ressources.mem_limit': ['mem_limit_bytes', value => TableView._fmtBytes(value)],
    'ressources.min_storage': ['min_storage_bytes', value => TableView._fmtBytes(value)],
    'ressources.pids_limit': ['pids_limit_int', value => TableView._fmtNumber(value)],
  };

  static PRESETS = {
    overview: ['Overview', MatrixView.DEFAULT],
    galaxy: ['Galaxy', [
      'role', 'main.galaxy_info.description', 'main.galaxy_info.galaxy_tags',
      'main.galaxy_info.author', 'main.galaxy_info.company', 'main.galaxy_info.license',
      'main.galaxy_info.min_ansible_version', 'main.galaxy_info.platforms', 'main.dependencies',
    ]],
    ressources: ['Ressources', ['role', 'services', ...Object.keys(MatrixView.RESSOURCES)]],
    network: ['Network', ['role', 'domains', 'networks', 'server', 'csp', 'volumes']],
  };

  static WIDTHS_KEY = 'mig-matrix-widths';

  static CHIPS = 6;

  // Args:
  //   view: the TableView whose filters, variant switch and cell helpers apply.
  //   loader: reads the meta/ files, once, the first time the matrix is shown.
  //   onChange: called after columns, order, search or density changed.
  //   cards: the RoleCardHost a role cell pins its card to.
  constructor(view, loader, container, onChange, cards) {
    this.view = view;
    this.tables = view.tables;
    this.loader = loader;
    this.container = container;
    this.onChange = onChange;
    this.cards = cards;
    this.columns = [...MatrixView.DEFAULT];
    this.sort = [{ id: 'role', dir: 'asc' }];
    this.complexity = false;
    this.find = '';
    this.density = 'compact';
    this.meta = null;
    this._loading = null;
    this._totals = new Map();
    this._distinct = new Map();
    this.widths = MatrixView._readWidths();
  }

  static _readWidths() {
    try {
      return JSON.parse(localStorage.getItem(MatrixView.WIDTHS_KEY)) || {};
    } catch {
      return {};
    }
  }

  _writeWidths() {
    try {
      localStorage.setItem(MatrixView.WIDTHS_KEY, JSON.stringify(this.widths));
    } catch {
      // A blocked store only costs the widths their persistence.
    }
  }

  static _isMap(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  static _empty(value) {
    return value === null || value === undefined || value === ''
      || (Array.isArray(value) && !value.length)
      || (MatrixView._isMap(value) && !Object.keys(value).length);
  }

  static _text(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(MatrixView._text).join(', ');
    if (MatrixView._isMap(value)) {
      const entries = Object.entries(value);
      return entries.some(([, inner]) => inner !== null && typeof inner === 'object')
        ? entries.map(([key]) => key).join(', ')
        : entries.map(([key, inner]) => `${key}: ${MatrixView._text(inner)}`).join(', ');
    }
    return String(value);
  }

  load() {
    if (this.meta) return Promise.resolve(this.meta);
    if (!this._loading) {
      this._loading = this.loader.loadMetaTree(this.view.roleInfo.graph.roles)
        .then(meta => {
          this.meta = meta;
          return meta;
        });
    }
    return this._loading;
  }

  _allRows() {
    const byName = new Map();
    for (const row of this.tables.complexityRows(this.view.variantAware)) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row);
    }
    const rows = [];
    for (const name of Object.keys(this.meta).sort()) {
      if (!this.view._keeps(name)) continue;
      rows.push(...(byName.get(name) || [{ name, variant: null }]));
    }
    return rows;
  }

  _rows(columns) {
    const needle = this.find.trim().toLowerCase();
    const rows = this._allRows().filter(row => !needle || columns.some(id => (
      id in MatrixView.RESSOURCES
        ? MatrixView.RESSOURCES[id][1](this._value(row, id))
        : MatrixView._text(this._value(row, id))
    ).toLowerCase().includes(needle)));
    return rows.sort((one, other) => this._compare(one, other));
  }

  _resources(name) {
    if (!this._totals.has(name)) this._totals.set(name, this.tables.resourcesOf(name).totals);
    return this._totals.get(name);
  }

  _value(row, id) {
    if (id === 'role') return row.name;
    if (id === 'variant') return row.variant;
    if (id.startsWith('complexity.')) return row[id.slice('complexity.'.length)];
    if (id in MatrixView.RESSOURCES) {
      const totals = this._resources(row.name);
      return totals ? totals[MatrixView.RESSOURCES[id][0]] : null;
    }
    const [file, ...path] = id.split('.');
    let value = file === 'services' && row.variant !== null && row.variant !== undefined
      ? this.tables.variantServices(row.name, row.variant)
      : (this.meta[row.name] || {})[file];
    for (const key of path) {
      if (!MatrixView._isMap(value)) return undefined;
      value = value[key];
    }
    return value;
  }

  _derived(id) {
    return id === 'role' || id === 'variant' || id.startsWith('complexity.')
      || id in MatrixView.RESSOURCES;
  }

  catalogue() {
    const ids = new Set(['role', ...MatrixView.COMPLEXITY, ...Object.keys(MatrixView.RESSOURCES)]);
    for (const files of Object.values(this.meta || {})) {
      for (const [file, data] of Object.entries(files)) {
        if (MatrixView._isMap(data)) for (const key of Object.keys(data)) ids.add(`${file}.${key}`);
        else ids.add(file);
      }
    }
    for (const id of this.columns) ids.add(id);
    return [...ids].sort((one, other) => (one === 'role' ? -1 : other === 'role' ? 1
      : one.localeCompare(other)));
  }

  // Every path down to the leaves, for a search: typing 'license' has to find
  // main.galaxy_info.license, which the browsable list only holds as part of
  // main.galaxy_info.
  _deep() {
    if (!this._deepIds) {
      const ids = new Set(this.catalogue());
      const walk = (value, path) => {
        if (!MatrixView._isMap(value)) return;
        for (const [key, inner] of Object.entries(value)) {
          ids.add(`${path}.${key}`);
          walk(inner, `${path}.${key}`);
        }
      };
      for (const files of Object.values(this.meta || {})) {
        for (const [file, data] of Object.entries(files)) walk(data, file);
      }
      this._deepIds = [...ids].sort();
    }
    return this._deepIds;
  }

  _search(needle) {
    const wanted = needle.trim().toLowerCase();
    return wanted
      ? this._deep().filter(id => id.toLowerCase().includes(wanted))
      : this.catalogue();
  }

  distinct(id) {
    if (!this._distinct.has(id)) {
      const seen = new Set(this._allRows().map(row => MatrixView._text(this._value(row, id))));
      this._distinct.set(id, seen.size);
    }
    return this._distinct.get(id);
  }

  // Returns: { common, rare } child ids. A key most roles never set would add
  // a column of empty cells, so only the ones in at least one in twenty rows
  // are common; the rest stay one menu entry away.
  children(id, rows) {
    if (this._derived(id)) return { common: [], rare: [] };
    const counts = new Map();
    for (const row of rows) {
      const value = this._value(row, id);
      if (!MatrixView._isMap(value)) continue;
      for (const key of Object.keys(value)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const floor = Math.max(2, Math.ceil(rows.length / 20));
    const common = [];
    const rare = [];
    for (const key of [...counts.keys()].sort()) {
      (counts.get(key) >= floor ? common : rare).push(`${id}.${key}`);
    }
    return { common, rare };
  }

  static _parent(id) {
    const cut = id.lastIndexOf('.');
    const parent = cut > 0 ? id.slice(0, cut) : null;
    return parent === 'complexity' || parent === 'ressources' ? null : parent;
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
    const { common, rare } = this.children(id, this._allRows());
    const children = (all ? [...common, ...rare] : common)
      .filter(child => !this.columns.includes(child));
    if (!children.length) return;
    const next = [...this.columns];
    next.splice(next.indexOf(id), 1, ...children);
    this.setColumns(next);
  }

  collapse(id) {
    const parent = MatrixView._parent(id);
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
      this.columns = [...new Set([...this.columns, ...MatrixView.COMPLEXITY])];
      this.sort = [{ id: 'complexity.weight', dir: 'desc' }];
    } else {
      this.columns = this.columns.filter(id => !MatrixView.COMPLEXITY.includes(id)
        || MatrixView.DEFAULT.includes(id));
      this.sort = [{ id: 'role', dir: 'asc' }];
    }
    this._changed();
  }

  preset(name) {
    this.complexity = false;
    this.sort = [{ id: 'role', dir: 'asc' }];
    this.setColumns([...MatrixView.PRESETS[name][1]]);
  }

  setFind(text) {
    this.find = text;
    if (this.onChange) this.onChange(this);
    this._renderTable();
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
      bar.replaceWith(this._toolbar());
      this._renderTable();
    }
    this.renderPicker(
      document.getElementById('matrix-columns'),
      (document.getElementById('matrix-columns-search') || {}).value || ''
    );
    if (this._picker) this.renderPicker(this._picker.list, this._picker.search.value);
  }

  _compare(one, other) {
    const key = (row, id) => {
      const value = this._value(row, id);
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return MatrixView._text(value).toLowerCase();
    };
    const empty = value => value === '' || value === null || value === undefined;
    for (const { id, dir } of this.sort) {
      const left = key(one, id);
      const right = key(other, id);
      if (empty(left) !== empty(right)) return empty(left) ? 1 : -1;
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      if (order) return dir === 'desc' ? -order : order;
    }
    return one.name.localeCompare(other.name) || (one.variant || 0) - (other.variant || 0);
  }

  _visible() {
    return this.view.variantAware
      ? ['role', 'variant', ...this.columns.filter(id => id !== 'role')]
      : this.columns;
  }

  show() {
    this.view.kind = 'matrix';
    this.closeMenu();
    this.container.innerHTML = '';
    if (!this.meta) {
      const waiting = document.createElement('p');
      waiting.className = 'table-note';
      waiting.textContent = 'Reading every meta/*.yml …';
      this.container.appendChild(waiting);
      return this.load().then(() => {
        this.renderPicker(document.getElementById('matrix-columns'), '');
        if (this.view.kind === 'matrix') this.show();
      });
    }

    const section = document.createElement('div');
    section.className = 'table-section matrix-section';
    section.appendChild(Object.assign(document.createElement('h2'), { textContent: 'Matrix' }));
    section.appendChild(this._toolbar());
    this.note = Object.assign(document.createElement('p'), { className: 'table-note' });
    section.appendChild(this.note);
    this.host = document.createElement('div');
    this.host.className = 'matrix-host';
    section.appendChild(this.host);
    this.container.appendChild(section);
    return Promise.resolve(this._renderTable());
  }

  _toolbar() {
    const bar = document.createElement('div');
    bar.className = 'matrix-toolbar';

    const search = Object.assign(document.createElement('input'), {
      type: 'search', id: 'matrix-find', className: 'form-control form-control-sm',
      placeholder: 'Search the visible columns …', value: this.find,
    });
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.setFind(search.value), 150);
    });
    bar.appendChild(search);

    const presets = document.createElement('div');
    presets.className = 'btn-group btn-group-sm matrix-presets';
    const current = this.columns.join(',');
    for (const [name, [label, columns]] of Object.entries(MatrixView.PRESETS)) {
      const chip = Object.assign(document.createElement('button'), {
        type: 'button', className: 'btn btn-outline-secondary', textContent: label,
      });
      chip.dataset.preset = name;
      const active = !this.complexity && columns.join(',') === current;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
      chip.addEventListener('click', () => this.preset(name));
      presets.appendChild(chip);
    }
    const complexity = Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn btn-outline-secondary', textContent: 'Complexity',
      title: 'Adds the complexity columns and orders the rows heaviest first.',
    });
    complexity.dataset.preset = 'complexity';
    complexity.classList.toggle('active', this.complexity);
    complexity.setAttribute('aria-pressed', String(this.complexity));
    complexity.addEventListener('click', () => this.setComplexity(!this.complexity));
    presets.appendChild(complexity);
    bar.appendChild(presets);

    const columns = Object.assign(document.createElement('button'), {
      type: 'button', id: 'matrix-columns-button', className: 'btn btn-sm btn-outline-secondary',
      textContent: `Columns ${this.columns.length}/${this.catalogue().length} ▾`,
    });
    columns.addEventListener('click', event => {
      event.stopPropagation();
      const box = columns.getBoundingClientRect();
      this.picker(box.left, box.bottom + 4);
    });
    bar.appendChild(columns);

    const density = document.createElement('div');
    density.className = 'btn-group btn-group-sm';
    for (const [value, label] of [['compact', 'Compact'], ['comfort', 'Comfort']]) {
      const button = Object.assign(document.createElement('button'), {
        type: 'button', className: 'btn btn-outline-secondary', textContent: label,
      });
      button.dataset.density = value;
      button.classList.toggle('active', this.density === value);
      button.addEventListener('click', () => this.setDensity(value));
      density.appendChild(button);
    }
    bar.appendChild(density);

    const csv = Object.assign(document.createElement('button'), {
      type: 'button', id: 'matrix-csv', className: 'btn btn-sm btn-outline-secondary',
      textContent: 'CSV', title: 'Download the rows and columns shown, in their order',
    });
    csv.addEventListener('click', () => this.download());
    bar.appendChild(csv);
    return bar;
  }

  _width(id) {
    if (this.widths[id]) return this.widths[id];
    if (id === 'role') return 200;
    if (id === 'variant') return 70;
    if (id.startsWith('complexity.') || id in MatrixView.RESSOURCES) return 110;
    return 180;
  }

  _renderTable() {
    if (!this.host) return [];
    const columns = this._visible();
    const rows = this._rows(columns);
    const table = document.createElement('table');
    table.className = `table table-sm role-matrix density-${this.density}`;
    const colgroup = table.appendChild(document.createElement('colgroup'));
    for (const id of columns) {
      const col = colgroup.appendChild(document.createElement('col'));
      col.dataset.column = id;
      col.style.width = `${this._width(id)}px`;
    }
    MatrixView._fit(table);

    const head = table.createTHead();
    const groups = head.insertRow();
    groups.className = 'matrix-groups';
    let last = null;
    for (const id of columns) {
      const group = MatrixView._parent(id) || (id.includes('.') ? id.split('.')[0] : '');
      if (last && last.dataset.group === group && group) {
        last.colSpan += 1;
        continue;
      }
      last = groups.appendChild(Object.assign(document.createElement('th'), { textContent: group }));
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

    this.host.innerHTML = '';
    this.host.appendChild(table);
    const total = this._allRows().length;
    this.note.textContent = `${rows.length}${rows.length === total ? '' : ` of ${total}`} rows, `
      + `${columns.length} of ${this.catalogue().length} columns. Click a heading to sort, `
      + 'shift-click to sort by more than one; drag it to move it, drag its edge to widen it; '
      + 'click a value to read all of it, click a role to pin its card.';
    return rows;
  }

  _head(id, rows) {
    const th = document.createElement('th');
    th.dataset.column = id;
    th.title = id;
    const derived = id.startsWith('complexity.') || id in MatrixView.RESSOURCES;
    const leaf = derived ? id.split('.').slice(1).join('.') : id.split('.').pop();

    const { common, rare } = this.children(id, rows);
    if (common.length || rare.length) {
      const unfold = Object.assign(document.createElement('span'), {
        className: 'matrix-unfold', textContent: '▸',
        title: `Unfold ${id} into its ${common.length} common keys`,
      });
      unfold.addEventListener('click', event => {
        event.stopPropagation();
        this.expand(id, !common.length);
      });
      th.appendChild(unfold);
    }
    th.appendChild(Object.assign(document.createElement('span'), {
      className: 'matrix-label', textContent: leaf,
    }));

    const at = this.sort.findIndex(key => key.id === id);
    if (at >= 0) {
      const dir = this.sort[at].dir;
      th.appendChild(Object.assign(document.createElement('span'), {
        className: 'matrix-sorted',
        textContent: `${dir === 'asc' ? '▲' : '▼'}${this.sort.length > 1 ? at + 1 : ''}`,
      }));
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    }

    if (id !== 'role' && id !== 'variant' && rows.length) {
      const filled = rows.filter(row => !MatrixView._empty(this._value(row, id))).length;
      th.appendChild(Object.assign(document.createElement('span'), {
        className: 'matrix-fill', textContent: `${Math.round((filled / rows.length) * 100)}%`,
        title: `${filled} of ${rows.length} rows carry a value`,
      }));
    }

    if (id === 'variant') return th;

    const more = Object.assign(document.createElement('button'), {
      type: 'button', className: 'matrix-more', textContent: '⋮', title: 'Column menu',
    });
    more.addEventListener('click', event => {
      event.stopPropagation();
      const box = more.getBoundingClientRect();
      this.menu(id, box.left, box.bottom, rows);
    });
    th.appendChild(more);

    const grip = Object.assign(document.createElement('span'), {
      className: 'matrix-resize', title: 'Drag to widen',
    });
    grip.addEventListener('mousedown', event => this._resize(event, id, th));
    grip.addEventListener('click', event => event.stopPropagation());
    th.appendChild(grip);

    th.addEventListener('mousedown', event => this._press(event, id));
    th.addEventListener('contextmenu', event => {
      event.preventDefault();
      this.menu(id, event.clientX, event.clientY, rows);
    });
    return th;
  }

  // Native drag and drop picked a neighbouring heading as its source inside
  // the sticky header, so a press is followed by hand: released in place it
  // sorts, moved past a few pixels it carries the column to where it is let go.
  _press(event, id) {
    if (event.button !== 0 || event.target.closest('.matrix-more, .matrix-resize, .matrix-unfold')) {
      return;
    }
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const under = at => {
      const hit = document.elementFromPoint(at.clientX, at.clientY);
      return hit ? hit.closest('table.role-matrix tr.matrix-keys th') : null;
    };
    const clear = () => {
      for (const cell of document.querySelectorAll('.matrix-drop')) cell.classList.remove('matrix-drop');
    };
    const step = moved => {
      if (!dragging && id !== 'role'
        && Math.abs(moved.clientX - start.x) + Math.abs(moved.clientY - start.y) > 6) {
        dragging = true;
        document.body.classList.add('matrix-dragging');
      }
      if (!dragging) return;
      clear();
      const target = under(moved);
      if (target && target.dataset.column !== id) target.classList.add('matrix-drop');
    };
    const release = up => {
      document.removeEventListener('mousemove', step);
      document.removeEventListener('mouseup', release);
      document.body.classList.remove('matrix-dragging');
      clear();
      if (!dragging) {
        this.sortBy(id, up.shiftKey);
        return;
      }
      const target = under(up);
      if (target && target.dataset.column && target.dataset.column !== id) {
        this.move(id, target.dataset.column);
      }
    };
    document.addEventListener('mousemove', step);
    document.addEventListener('mouseup', release);
  }

  // A fixed table spreads any width beyond its columns over all of them, and
  // max-content would measure every unbroken description; only an explicit sum
  // leaves each column the width it was given.
  static _fit(table) {
    const cols = [...table.querySelectorAll('col')];
    table.style.width = `${cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0)}px`;
  }

  _resize(event, id, th) {
    event.preventDefault();
    event.stopPropagation();
    const table = th.closest('table');
    const col = table.querySelector(`col[data-column="${CSS.escape(id)}"]`);
    const start = event.clientX;
    const width = parseFloat(col.style.width);
    const step = moved => {
      this.widths[id] = Math.max(60, Math.round(width + moved.clientX - start));
      col.style.width = `${this.widths[id]}px`;
      MatrixView._fit(table);
    };
    const stop = () => {
      document.removeEventListener('mousemove', step);
      document.removeEventListener('mouseup', stop);
      this._writeWidths();
    };
    document.addEventListener('mousemove', step);
    document.addEventListener('mouseup', stop);
  }

  _chips(items, make) {
    const cell = document.createElement('td');
    cell.className = 'matrix-chips';
    for (const item of items.slice(0, MatrixView.CHIPS)) cell.appendChild(make(item));
    if (items.length > MatrixView.CHIPS) {
      cell.appendChild(Object.assign(document.createElement('span'), {
        className: 'chip matrix-more-chips', textContent: `+${items.length - MatrixView.CHIPS}`,
      }));
    }
    return cell;
  }

  _cell(row, id) {
    const value = this._value(row, id);
    if (id === 'role') {
      const cell = this.view._roleCell(row.name);
      cell.classList.add('matrix-role');
      cell.addEventListener('click', () => {
        const box = cell.getBoundingClientRect();
        this.cards.pin(row.name, () => ({ x: box.right, y: box.top }));
      });
      return cell;
    }
    if (id === 'variant') return TableView._cell(TableView._fmtVariant(value), 'num');
    if (MatrixView._empty(value)) {
      return TableView._cell('·', 'matrix-empty');
    }

    let cell;
    if (id === 'complexity.siblings') {
      cell = this.view._roleListCell(value);
    } else if (typeof value === 'boolean') {
      cell = this.view._boolCell(value);
    } else if (id in MatrixView.RESSOURCES) {
      cell = TableView._cell(MatrixView.RESSOURCES[id][1](value), 'num');
    } else if (typeof value === 'number') {
      cell = TableView._cell(String(value), 'num');
    } else if (id === 'services' && MatrixView._isMap(value)) {
      cell = this._chips(Object.keys(value), key => this.view.roleInfo.serviceChip(key));
    } else if (id === 'main.dependencies' && Array.isArray(value)) {
      cell = this._chips(value.map(String), role => {
        const chip = Object.assign(document.createElement('span'), {
          className: 'chip service', textContent: role,
        });
        chip.dataset.roleName = role;
        return chip;
      });
    } else if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
      cell = this._chips(value.map(String), item => Object.assign(document.createElement('span'), {
        className: 'chip', textContent: item,
      }));
    } else {
      const text = MatrixView._text(value);
      cell = TableView._cell(text, 'matrix-text');
      cell.title = text;
    }
    cell.classList.add('matrix-value');
    cell.addEventListener('click', event => {
      if (event.target.closest('[data-role-name]')) return;
      const structured = value !== null && typeof value === 'object';
      if (!structured && cell.scrollWidth <= cell.clientWidth) return;
      this.detail(row, id, event.clientX, event.clientY);
    });
    return cell;
  }

  _float(className, x, y) {
    this.closeMenu();
    const panel = document.createElement('div');
    panel.className = `${className} matrix-float`;
    document.body.appendChild(panel);
    const place = () => {
      const box = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    };
    this._outside = event => {
      if (!panel.contains(event.target)) this.closeMenu();
    };
    this._escape = event => {
      if (event.key === 'Escape') this.closeMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._outside);
      document.addEventListener('keydown', this._escape);
    });
    return { panel, place };
  }

  detail(row, id, x, y) {
    const { panel, place } = this._float('matrix-detail', x, y);
    const title = document.createElement('div');
    title.className = 'matrix-detail-title';
    title.textContent = `${row.name}${row.variant !== null && row.variant !== undefined
      ? ` #${row.variant}` : ''} · ${id}`;
    panel.appendChild(title);
    const value = this._value(row, id);
    const body = document.createElement('pre');
    body.textContent = typeof value === 'object' && value !== null
      ? jsyaml.dump(value, { lineWidth: 100 }).trimEnd()
      : String(value);
    panel.appendChild(body);
    place();
  }

  menu(id, x, y, rows) {
    const { panel, place } = this._float('matrix-menu dropdown-menu show', x, y);
    const item = (into, text, action, disabled) => {
      const button = Object.assign(document.createElement('button'), {
        type: 'button', className: 'dropdown-item', textContent: text, disabled,
      });
      button.addEventListener('click', () => {
        this.closeMenu();
        action();
      });
      into.appendChild(button);
    };
    item(panel, 'Sort ascending', () => this.setSort(id, 'asc'), false);
    item(panel, 'Sort descending', () => this.setSort(id, 'desc'), false);
    const { common, rare } = this.children(id, rows);
    item(panel, `Unfold into ${common.length} common columns`, () => this.expand(id, false),
      !common.length);
    if (rare.length) {
      item(panel, `Unfold all ${common.length + rare.length} (${rare.length} rare)`,
        () => this.expand(id, true), false);
    }
    const parent = MatrixView._parent(id);
    item(panel, `Fold into ${parent || 'its parent'}`, () => this.collapse(id), !parent);
    item(panel, 'Remove this column', () => this.remove(id), id === 'role');

    panel.appendChild(Object.assign(document.createElement('div'), { className: 'dropdown-divider' }));
    const search = Object.assign(document.createElement('input'), {
      type: 'search', className: 'form-control form-control-sm', placeholder: 'Add a column …',
    });
    const list = Object.assign(document.createElement('div'), { className: 'matrix-menu-list' });
    const fill = () => {
      list.innerHTML = '';
      const hidden = this._search(search.value).filter(column => !this.columns.includes(column));
      for (const column of hidden.slice(0, 80)) {
        item(list, column, () => this.add(column, id), false);
      }
      if (hidden.length > 80) {
        list.appendChild(Object.assign(document.createElement('div'), {
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
    const search = Object.assign(document.createElement('input'), {
      type: 'search', className: 'form-control form-control-sm', placeholder: 'Filter columns …',
    });
    const reset = Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn btn-sm btn-outline-primary', textContent: 'Default',
    });
    reset.addEventListener('click', () => this.setColumns([...MatrixView.DEFAULT]));
    const top = document.createElement('div');
    top.className = 'd-flex gap-1 mb-1';
    top.append(search, reset);
    const list = document.createElement('div');
    list.className = 'matrix-columns';
    panel.append(top, list);
    search.addEventListener('input', () => this.renderPicker(list, search.value));
    this.renderPicker(list, '');
    place();
    this._picker = { list, search };
    search.focus();
  }

  closeMenu() {
    this._picker = null;
    for (const open of document.querySelectorAll('.matrix-float')) open.remove();
    if (this._outside) document.removeEventListener('mousedown', this._outside);
    if (this._escape) document.removeEventListener('keydown', this._escape);
    this._outside = null;
    this._escape = null;
  }

  // Args:
  //   host: the element to fill; the design panel's list and the popover at the
  //     table both render through here.
  //   needle: narrows the list to columns whose id contains it.
  renderPicker(host, needle) {
    if (!host) return;
    if (!this.meta) {
      host.textContent = 'Open the matrix once to list its columns.';
      return;
    }
    host.innerHTML = '';
    const groups = new Map();
    for (const id of this._search(needle)) {
      const group = id.split('.')[0];
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(id);
    }
    for (const [group, ids] of groups) {
      host.appendChild(Object.assign(document.createElement('div'), {
        className: 'matrix-columns-group', textContent: group,
      }));
      for (const id of ids) {
        const row = document.createElement('label');
        row.className = 'matrix-columns-row';
        const box = Object.assign(document.createElement('input'), {
          type: 'checkbox', checked: this.columns.includes(id), disabled: id === 'role',
        });
        box.dataset.column = id;
        box.addEventListener('change', () => (box.checked ? this.add(id) : this.remove(id)));
        row.append(box, ` ${id}`);
        if (id !== 'role' && this.distinct(id) <= 1) {
          row.appendChild(Object.assign(document.createElement('span'), {
            className: 'matrix-const', textContent: 'constant',
            title: 'Every role carries the same value here',
          }));
        }
        host.appendChild(row);
      }
    }
  }

  download() {
    const columns = this._visible();
    const rows = this._rows(columns);
    const quote = text => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const lines = [columns.map(quote).join(',')];
    for (const row of rows) {
      lines.push(columns.map(id => {
        const value = this._value(row, id);
        return quote(id in MatrixView.RESSOURCES
          ? MatrixView.RESSOURCES[id][1](value)
          : MatrixView._text(value));
      }).join(','));
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
    link.download = 'mig-matrix.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href));
    return lines;
  }
}

window.MatrixView = MatrixView;
