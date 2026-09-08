class TestsView {
  // Args:
  //   tables: MetaTables, for variantCount() and variantServices().
  //   loader: DataLoader, for the suites, the shared harness and the CI plan.
  //   roleInfo: for the role label and its hover card.
  constructor(tables, loader, roleInfo, container) {
    this.tables = tables;
    this.loader = loader;
    this.roleInfo = roleInfo;
    this.container = container;
    this.section = null;
    this.loaded = null;
    this.filters = {};
    this.sort = 'name';
    this.kind = 'playwright';
    this.gate = 'all';
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
      this.loader.loadCiOrder(),
    ]).then(([variants, mcp, meta, harness, suites, cli, ci]) => {
      this.tables.setVariants(variants);
      this.matrix = new PlaywrightMatrix(PlaywrightMatrix.parseHarness(harness));
      this.mcp = mcp;
      this.meta = meta;
      this.suites = suites;
      this.cli = cli;
      this._setCi(ci);
      this._render();
    }).catch(error => {
      this.note.textContent = `Could not read the test suites: ${error.message}`;
    });
  }

  _keeps(role) {
    return this.roleInfo.graph.matches(role, this.filters);
  }

  _variants(role) {
    const count = this.tables.variantCount(role);
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
  //   plan: meta/ci-order.json, or null when core never wrote it.
  _setCi(plan) {
    this.ci = plan;
    this.rank = new Map();
    for (const row of (plan && plan.rows) || []) {
      this.rank.set(`${row.role}#${row.variant}`, row);
    }
  }

  // A role without meta/variants.yml is one variant to the planner, so its
  // rank sits under index 0 while the matrix calls that row's variant null.
  _plan(row) {
    return this.rank.get(`${row.role}#${row.variant === null ? 0 : row.variant}`);
  }

  _sorted(rows) {
    if (this.sort !== 'ci') return rows;
    return [...rows].sort((left, right) => {
      const a = this._plan(left);
      const b = this._plan(right);
      if (a && b) return a.id - b.id;
      if (a) return -1;
      if (b) return 1;
      return 0;
    });
  }

  _ciNote() {
    if (!this.ci) {
      return ' No meta/ci-order.json: run make ci-order in the core checkout to'
        + ' sort by the deploy order.';
    }
    return ` CI order from meta/ci-order.json, generated ${this.ci.generated_at}`
      + ` at ${this.ci.commit}: ${this.rank.size} planned rows in ${this.ci.chunks}`
      + ` chunks of ${this.ci.chunk_size}.`
      + (this.ci.seed ? '' : ' The seed is unset, so ties order differently on every sweep.');
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

  _render() {
    const all = this.kind === 'cli' ? this._cliRows() : this._playwrightRows();
    const rows = this.gate === 'all' ? all : all.filter(row => row.gate === this.gate);
    this.note.textContent = this._note(all, rows);

    const table = document.createElement('table');
    table.className = 'tests-matrix';
    table.appendChild(TableView._headRow(
      this.kind === 'cli'
        ? ['role', 'variant', 'chunk', 'script', 'runs', 'timeout', 'env flags', 'shared harness']
        : ['role', 'variant', 'chunk', 'test', 'runs', 'skip gates', 'branch gates', 'why']
    ));
    const body = document.createElement('tbody');
    for (const row of this._sorted(rows)) body.appendChild(this._row(row));
    table.appendChild(body);
    this.scroller.innerHTML = '';
    this.scroller.appendChild(table);
  }

  _row(row) {
    const tr = document.createElement('tr');
    tr.className = `pw-${row.gate}`;

    const role = document.createElement('td');
    role.dataset.roleName = row.role;
    role.appendChild(this.roleInfo.label(row.role));
    tr.appendChild(role);

    tr.appendChild(TestsView._cell(row.variant === null ? 'base' : String(row.variant)));

    const plan = this._plan(row);
    const chunk = TestsView._cell(
      plan && plan.chunk !== null ? String(plan.chunk) : '', 'pw-chunk'
    );
    if (plan && plan.chunk === null) chunk.title = 'beyond this sweep’s budget';
    if (!plan) chunk.title = 'not a row of the CI sweep plan';
    tr.appendChild(chunk);

    tr.appendChild(TestsView._cell(row.test, 'pw-test'));

    const status = TestsView.STATUS[row.gate];
    const mark = TestsView._cell(status.mark, 'pw-status');
    mark.title = status.title;
    tr.appendChild(mark);

    if (this.kind === 'cli') {
      tr.appendChild(TestsView._cell(row.timeout ? `${row.timeout}s` : '', 'pw-chunk'));
      tr.appendChild(TestsView._chips(row.flags));
      tr.appendChild(TestsView._chips(row.shared));
      return tr;
    }

    tr.appendChild(TestsView._chips(row.skip));
    tr.appendChild(TestsView._chips(row.branch));
    tr.appendChild(TestsView._cell(row.reasons.join('; '), 'pw-why'));
    return tr;
  }

  static _cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  static _chips(services) {
    const td = document.createElement('td');
    td.className = 'chips';
    for (const service of services || []) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = service;
      td.appendChild(chip);
    }
    return td;
  }
}

window.TestsView = TestsView;
