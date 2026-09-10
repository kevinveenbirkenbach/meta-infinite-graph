class TestsCatalog {
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

  // Args:
  //   tables: MetaTables, for variantCount() and variantServices().
  //   loader: DataLoader, for the suites, the shared harness and the CI plan.
  //   roleInfo: for the role label and its hover card.
  constructor(tables, loader, roleInfo) {
    this.tables = tables;
    this.loader = loader;
    this.roleInfo = roleInfo;
    this.filters = {};
    this.sort = 'name';
    this.kind = 'playwright';
    this.gate = 'all';
    this.variantAware = false;
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
    return TestsCatalog._scope(rows);
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
      : ` Showing the ${shown.length} rows gated ${TestsCatalog.GATES[this.gate]}.`;
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
}

window.TestsCatalog = TestsCatalog;
