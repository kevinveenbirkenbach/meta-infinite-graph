class TestsView extends TestsCatalog {
  constructor(tables, loader, roleInfo, cardHost, container) {
    super(tables, loader, roleInfo);
    this.cardHost = cardHost;
    this.container = container;
    this.section = null;
    this.loaded = null;
  }

  setFilters(filters) {
    this.filters = filters || {};
    this.section = null;
  }

  setSort(kind) {
    this.sort = TestsView.SORTS[kind] ? kind : 'name';
    const select = document.getElementById('tests-sort');
    if (select) select.value = this.sort;
    if (this.scroller) this._render();
  }

  setGate(gate) {
    this.gate = TestsView.GATES[gate] ? gate : 'all';
    const select = document.getElementById('tests-gate');
    if (select) select.value = this.gate;
    if (this.scroller) this._render();
  }

  setKind(kind) {
    this.kind = TestsView.KINDS[kind] ? kind : 'playwright';
    for (const input of document.querySelectorAll('input[name="tests-kind"]')) {
      input.checked = input.value === this.kind;
    }
    if (this.scroller) this._render();
  }

  refresh() {
    if (this.scroller) this._render();
  }

  invalidate() {
    this.section = null;
    this.loaded = null;
  }

  show() {
    this.container.innerHTML = '';
    if (!this.section) {
      this.section = this._shell();
      this.loaded = this._load();
    }
    this.container.appendChild(this.section);
  }

  _shell() {
    const section = el('div', { className: 'table-section' });
    const heading = el('h2', { textContent: 'Tests' });
    this.note = el('p', { className: 'table-note', textContent: 'Reading every role’s test suite…' });

    const group = el('div', { className: 'btn-group btn-group-sm tests-kind' });
    for (const [value, label] of Object.entries(TestsView.KINDS)) {
      const input = el('input', {
        type: 'radio', className: 'btn-check', name: 'tests-kind', id: `tests-kind-${value}`,
        value, checked: value === this.kind,
      });
      input.addEventListener('change', () => {
        this.kind = value;
        this._render();
        if (this.onChange) this.onChange();
      });
      const text = el('label', { className: 'btn btn-outline-primary', textContent: label });
      text.setAttribute('for', input.id);
      group.append(input, text);
    }

    this.scroller = el('div', { className: 'table-scroll' });
    section.append(heading, group, this.note, this.scroller);
    return section;
  }

  _load() {
    const roles = this.roleInfo.graph.roles;
    return Promise.all([
      this.loader.loadSideFileAll(roles, 'variants'),
      this.loader.loadSideFileAll(roles, 'mcp'),
      this.loader.loadSideFileAll(roles, 'tests'),
      this.loader.loadHarness(),
      this.loader.loadPlaywrightAll(roles),
      this.loader.loadCliAll(roles),
      this.loader.loadSettings(),
      this.loader.loadStackAll(roles),
      this.loader.loadCategories(),
    ]).then(([variants, mcp, meta, harness, suites, cli, env, stacks, categories]) => {
      this.tables.setVariants(variants);
      this.matrix = new PlaywrightMatrix(PlaywrightMatrix.parseHarness(harness));
      this.mcp = mcp;
      this.meta = meta;
      this.suites = suites;
      this.cli = cli;
      this._setCi(CiOrder.parse(env), stacks, categories);
      this._render();
    }).catch(error => {
      this.note.textContent = `Could not read the test suites: ${error.message}`;
    });
  }

  _render() {
    const all = this.kind === 'cli' ? this._cliRows() : this._playwrightRows();
    const rows = this.gate === 'all' ? all : all.filter(row => row.gate === this.gate);
    this.note.textContent = this._note(all, rows);

    const lines = TestsView._lines(this._sorted(rows));
    const width = lines.reduce((most, line) => Math.max(most, line.cells.length), 0);

    this.detail = new Map();
    const table = el('table', { className: 'tests-matrix' });
    table.appendChild(TestsView._head(width));
    const body = document.createElement('tbody');
    for (const line of lines) body.appendChild(this._line(line, width));
    table.appendChild(body);

    this.scroller.innerHTML = '';
    this.scroller.appendChild(table);
    this._bind(table);
  }

  static _head(width) {
    const tr = document.createElement('tr');
    for (const label of ['role', 'variant', 'rank']) {
      tr.appendChild(el('th', { className: 'tests-axis', textContent: label }));
    }
    for (let index = 0; index < width; index += 1) {
      tr.appendChild(el('th', { textContent: String(index + 1) }));
    }
    const thead = document.createElement('thead');
    thead.appendChild(tr);
    return thead;
  }

  _line(line, width) {
    const tr = document.createElement('tr');

    const role = el('th', { className: 'tests-axis' });
    role.dataset.roleName = line.role;
    role.appendChild(this.roleInfo.label(line.role));
    tr.appendChild(role);

    tr.appendChild(el('th', {
      className: 'tests-axis', textContent: line.variant === null ? 'base' : String(line.variant),
    }));

    const plan = this._plan(line);
    const rank = el('th', { className: 'tests-axis', textContent: plan ? String(plan.rank) : '' });
    if (!plan) rank.title = 'CI discovery does not deploy this role and variant';
    tr.appendChild(rank);

    for (let index = 0; index < width; index += 1) {
      tr.appendChild(this._cellFor(line.cells[index]));
    }
    return tr;
  }

  _cellFor(row) {
    if (!row) return el('td', { className: 'tests-blank' });
    const td = el('td', { className: `pw-${row.gate}`, textContent: TestsView.STATUS[row.gate].mark });
    const key = String(this.detail.size);
    this.detail.set(key, row);
    td.dataset.cell = key;
    return td;
  }

  _bind(table) {
    table.addEventListener('mouseover', event => {
      const cell = event.target.closest('[data-cell]');
      if (!cell) return;
      const row = this.detail.get(cell.dataset.cell);
      const box = cell.getBoundingClientRect();
      this.cardHost.show(
        `#test-${cell.dataset.cell}`,
        { x: box.left, y: box.bottom },
        () => TestsView.card(row, this.roleInfo, this._plan(row))
      );
    });
    table.addEventListener('mouseout', event => {
      const cell = event.target.closest('[data-cell]');
      if (cell) this.cardHost.release(`#test-${cell.dataset.cell}`);
    });
  }

  // Args:
  //   row: the cell's test row.
  //   plan: its meta/ci-order.json entry, or undefined when the sweep skips it.
  static card(row, roleInfo, plan) {
    const card = el('div', { className: 'role-card test-card' });

    const status = TestsView.STATUS[row.gate];
    const title = el('div', { className: 'role-card-title' });
    title.appendChild(roleInfo.iconFor(row.role));
    title.appendChild(document.createTextNode(` ${status.mark} ${row.role}`));
    card.appendChild(title);
    card.appendChild(el('p', { className: 'role-card-desc', textContent: row.test }));

    const facts = el('dl', { className: 'role-card-facts' });
    const scalars = [
      ['Variant', row.variant === null ? 'base' : String(row.variant)],
      ['Gate', status.title],
      ['CI rank', plan ? String(plan.rank) : 'not discovered'],
      ['Timeout', row.timeout ? `${row.timeout}s` : ''],
      ['Why', (row.reasons || []).join('; ')],
    ].filter(([, value]) => value);
    for (const [term, value] of scalars) {
      facts.append(textElement('dt', term), textElement('dd', value));
    }
    for (const [term, items] of [
      ['Skip gates', row.skip],
      ['Branch gates', row.branch],
      ['Env flags', row.flags],
      ['Shared harness', row.shared],
    ]) {
      if (!items || !items.length) continue;
      const definition = el('dd', { className: 'chips' });
      const services = term === 'Skip gates' || term === 'Branch gates';
      for (const item of items) {
        definition.appendChild(services
          ? roleInfo.serviceChip(item)
          : textElement('span', item, 'chip'));
      }
      facts.append(textElement('dt', term), definition);
    }
    card.appendChild(facts);
    return card;
  }
}

window.TestsView = TestsView;
