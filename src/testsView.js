class TestsView {
  // Args:
  //   tables: MetaTables, for variantCount() and variantServices().
  //   loader: DataLoader, for the suites, the shared harness and the CI plan.
  //   roleInfo: for the role label and its hover card.
  constructor(tables, loader, roleInfo, cardHost, container) {
    this.tables = tables;
    this.loader = loader;
    this.roleInfo = roleInfo;
    this.cardHost = cardHost;
    this.container = container;
    this.section = null;
    this.loaded = null;
    this.filters = {};
    this.sort = 'name';
    this.kind = 'playwright';
    this.gate = 'all';
    this.variantAware = false;
  }

  static KINDS = {
    playwright: 'Playwright',
    cli: 'CLI',
  };

  static GATES = {
    all: 'all',
    runs: 'runs',
    never: 'never',
    skipped: 'not in this variant',
    always: 'always maybe',
    unknown: 'maybe in this variant',
  };

  static SORTS = {
    name: 'role name ▲',
    ci: 'CI chunk order',
  };

  static STATUS = {
    runs: { mark: '✅', title: 'every skip gate is on' },
    never: { mark: '⛔', title: 'a skip gate is off in every variant, so this test never runs' },
    skipped: { mark: '➖', title: 'a skip gate is off here; the test runs in another variant' },
    always: { mark: '❓', title: 'no variant settles this gate, so the test is never certain' },
    unknown: { mark: '❔', title: 'this variant leaves the gate open; another one settles it' },
  };

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
    const section = document.createElement('div');
    section.className = 'table-section';
    const heading = document.createElement('h2');
    heading.textContent = 'Tests';
    this.note = document.createElement('p');
    this.note.className = 'table-note';
    this.note.textContent = 'Reading every role’s test suite…';

    const group = document.createElement('div');
    group.className = 'btn-group btn-group-sm tests-kind';
    for (const [value, label] of Object.entries(TestsView.KINDS)) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.className = 'btn-check';
      input.name = 'tests-kind';
      input.id = `tests-kind-${value}`;
      input.value = value;
      input.checked = value === this.kind;
      input.addEventListener('change', () => {
        this.kind = value;
        this._render();
        if (this.onChange) this.onChange();
      });
      const text = document.createElement('label');
      text.className = 'btn btn-outline-primary';
      text.setAttribute('for', input.id);
      text.textContent = label;
      group.append(input, text);
    }

    this.scroller = document.createElement('div');
    this.scroller.className = 'table-scroll';
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

  _keeps(role) {
    return this.roleInfo.graph.matches(role, this.filters);
  }

  // Off, a role is one line against its base meta/services.yml, which leaves
  // every group_names flag unsettled; on, one line per meta/variants.yml entry.
  _variants(role) {
    const count = this.variantAware ? this.tables.variantCount(role) : 0;
    return count ? [...Array(count).keys()] : [null];
  }

  _playwrightRows() {
    const rows = [];
    for (const role of Object.keys(this.suites).sort()) {
      if (!this._keeps(role)) continue;
      const suite = this.suites[role];
      const flags = PlaywrightMatrix.parseEnv(suite.env);
      const tests = this.matrix.parseSuite(suite.files);
      for (const variant of this._variants(role)) {
        const payload = {
          services: this.tables.variantServices(role, variant),
          mcp: this.mcp[role] || undefined,
        };
        rows.push(...this.matrix.rows(role, variant, payload, flags, tests));
      }
    }
    return TestsView._scope(rows);
  }

  // The parser answers per variant. Whether a test can ever run, or can ever be
  // known to run, is a property of the whole role and only shows once its
  // sibling rows are in.
  static _scope(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.role, row.test]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) {
      const never = group.every(row => row.status === 'skipped');
      const always = group.every(row => row.status === 'unknown');
      for (const row of group) {
        if (row.status === 'skipped') row.gate = never ? 'never' : 'skipped';
        else if (row.status === 'unknown') row.gate = always ? 'always' : 'unknown';
        else row.gate = row.status;
      }
    }
    return rows;
  }

  // A CLI test is one script per role with no service-gate contract, so a row
  // is a whole run rather than a case and nothing can switch it off per service.
  _cliRows() {
    const rows = [];
    for (const role of Object.keys(this.cli).sort()) {
      if (!this._keeps(role)) continue;
      const suite = this.cli[role];
      for (const variant of this._variants(role)) {
        rows.push({
          role,
          variant,
          test: 'files/test/test.sh',
          status: 'runs',
          gate: 'runs',
          reasons: [],
          timeout: suite.timeout,
          flags: suite.flags,
          shared: suite.shared,
        });
      }
    }
    return rows;
  }

  // Args:
  //   settings: the parsed infinito.env; empty when it is not mounted.
  //   stacks: role -> whether it ships its own compose template.
  //   categories: the roles tree, for the invokable paths.
  _setCi(settings, stacks, categories) {
    this.settings = settings;
    this.rank = new Map();
    this.best = new Map();
    if (!settings.INFINITO_DISCOVERY_SORT) return;

    const order = new CiOrder(settings);
    const invokable = MetaTables.invokablePaths(categories);
    const rows = this.tables.complexityRows(true).map(row => ({
      ...row,
      ...order.columns({
        name: row.name,
        lifecycle: row.lifecycle,
        stack: stacks[row.name],
        modes: this.tables.primaryEntry(row.name).modes,
        testSkips: (this.meta[row.name] || {}).skip,
      }, invokable),
    }));
    for (const row of order.rank(rows)) {
      this.rank.set(`${row.name}#${row.variant === null ? 0 : row.variant}`, row);
      const best = this.best.get(row.name);
      if (!best || row.rank < best.rank) this.best.set(row.name, row);
    }
  }

  // A variant-blind line stands for the whole role, so it takes the role's
  // earliest rank. Variant 0's rank would put a role behind others that CI
  // reaches later, because a role's first deploy is often another variant.
  _plan(row) {
    if (row.variant === null) return this.best.get(row.role);
    return this.rank.get(`${row.role}#${row.variant}`);
  }

  _sorted(rows) {
    if (this.sort !== 'ci') return rows;
    return [...rows].sort((left, right) => {
      const a = this._plan(left);
      const b = this._plan(right);
      if (a && b) return a.rank - b.rank;
      if (a) return -1;
      if (b) return 1;
      return 0;
    });
  }

  _ciNote() {
    if (!this.rank.size) {
      return ' No INFINITO_DISCOVERY_SORT: mount the core checkout\'s default.env'
        + ' (INFINITO_ENV_FILE) to sort by the deploy order.';
    }
    return ` CI order derived here from ${this.rank.size} discovered rows, by`
      + ` INFINITO_DISCOVERY_SORT. Ties fall back to the role name: the last key`
      + ` of that spec is a nonce core draws per run, which nothing can reproduce.`;
  }

  // Args:
  //   all: every row of the current kind, before the gate narrows them.
  //   shown: the rows the table renders.
  _note(all, shown) {
    const roles = new Set(all.map(row => row.role)).size;
    const tail = this.sort === 'ci' ? this._ciNote() : '';
    const narrowed = shown.length === all.length
      ? ''
      : ` Showing the ${shown.length} rows gated ${TestsView.GATES[this.gate]}.`;
    if (this.kind === 'cli') {
      return `${all.length} CLI runs across ${roles} roles. One row is one`
        + ' run of the role\'s files/test/test.sh after that variant deployed.'
        + ' CLI tests declare no <NAME>_SERVICE_ENABLED flags, so no service'
        + ` switches one off; the env column lists what the role does declare.`
        + `${narrowed}${tail}`;
    }
    const counts = { runs: 0, never: 0, skipped: 0, always: 0, unknown: 0 };
    for (const row of all) counts[row.gate] += 1;
    return `${all.length} test runs across ${roles} roles. ${counts.runs} run. `
      + `${counts.never} never run because a gate is off in every variant, `
      + `${counts.skipped} are skipped only in their own variant. `
      + `${counts.always} are never certain because no variant settles their gate, `
      + `${counts.unknown} are open only in their own variant. `
      + `A row is one test in one variant.${narrowed}${tail}`;
  }

  // Args:
  //   rows: the rows the gate left, already in display order.
  // Returns: one line per role and variant, its cells in the spec's own order.
  static _lines(rows) {
    const lines = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.role, row.variant]);
      if (!lines.has(key)) lines.set(key, { role: row.role, variant: row.variant, cells: [] });
      lines.get(key).cells.push(row);
    }
    return [...lines.values()];
  }

  _render() {
    const all = this.kind === 'cli' ? this._cliRows() : this._playwrightRows();
    const rows = this.gate === 'all' ? all : all.filter(row => row.gate === this.gate);
    this.note.textContent = this._note(all, rows);

    const lines = TestsView._lines(this._sorted(rows));
    const width = lines.reduce((most, line) => Math.max(most, line.cells.length), 0);

    this.detail = new Map();
    const table = document.createElement('table');
    table.className = 'tests-matrix';
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
      const th = document.createElement('th');
      th.className = 'tests-axis';
      th.textContent = label;
      tr.appendChild(th);
    }
    for (let index = 0; index < width; index += 1) {
      const th = document.createElement('th');
      th.textContent = String(index + 1);
      tr.appendChild(th);
    }
    const thead = document.createElement('thead');
    thead.appendChild(tr);
    return thead;
  }

  _line(line, width) {
    const tr = document.createElement('tr');

    const role = document.createElement('th');
    role.className = 'tests-axis';
    role.dataset.roleName = line.role;
    role.appendChild(this.roleInfo.label(line.role));
    tr.appendChild(role);

    const variant = document.createElement('th');
    variant.className = 'tests-axis';
    variant.textContent = line.variant === null ? 'base' : String(line.variant);
    tr.appendChild(variant);

    const plan = this._plan(line);
    const rank = document.createElement('th');
    rank.className = 'tests-axis';
    rank.textContent = plan ? String(plan.rank) : '';
    if (!plan) rank.title = 'CI discovery does not deploy this role and variant';
    tr.appendChild(rank);

    for (let index = 0; index < width; index += 1) {
      tr.appendChild(this._cellFor(line.cells[index]));
    }
    return tr;
  }

  _cellFor(row) {
    const td = document.createElement('td');
    if (!row) {
      td.className = 'tests-blank';
      return td;
    }
    const status = TestsView.STATUS[row.gate];
    td.className = `pw-${row.gate}`;
    td.textContent = status.mark;
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
    const card = document.createElement('div');
    card.className = 'role-card test-card';

    const status = TestsView.STATUS[row.gate];
    const title = document.createElement('div');
    title.className = 'role-card-title';
    title.appendChild(roleInfo.iconFor(row.role));
    title.appendChild(document.createTextNode(` ${status.mark} ${row.role}`));
    card.appendChild(title);

    const name = document.createElement('p');
    name.className = 'role-card-desc';
    name.textContent = row.test;
    card.appendChild(name);

    const facts = document.createElement('dl');
    facts.className = 'role-card-facts';
    const scalars = [
      ['Variant', row.variant === null ? 'base' : String(row.variant)],
      ['Gate', status.title],
      ['CI rank', plan ? String(plan.rank) : 'not discovered'],
      ['Timeout', row.timeout ? `${row.timeout}s` : ''],
      ['Why', (row.reasons || []).join('; ')],
    ].filter(([, value]) => value);
    for (const [term, value] of scalars) {
      facts.append(TestsView._text('dt', term), TestsView._text('dd', value));
    }
    for (const [term, items] of [
      ['Skip gates', row.skip],
      ['Branch gates', row.branch],
      ['Env flags', row.flags],
      ['Shared harness', row.shared],
    ]) {
      if (!items || !items.length) continue;
      const definition = document.createElement('dd');
      definition.className = 'chips';
      const services = term === 'Skip gates' || term === 'Branch gates';
      for (const item of items) {
        definition.appendChild(services
          ? roleInfo.serviceChip(item)
          : TestsView._text('span', item, 'chip'));
      }
      facts.append(TestsView._text('dt', term), definition);
    }
    card.appendChild(facts);
    return card;
  }

  static _text(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }
}

window.TestsView = TestsView;
