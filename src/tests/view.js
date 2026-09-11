import { CiOrder } from '../ciOrder.js';
import { byId, el } from '../dom.js';
import { html, render, toElement } from '../html.js';
import { t } from '../i18n.js';
import { PlaywrightMatrix } from '../playwrightMatrix.js';
import { TestsCatalog } from './catalog.js';
import { TestsGrid } from './grid.js';
import { fillRun } from './runCard.js';

export class TestsView extends TestsCatalog {
  // Args:
  //   runs: TestRuns, for the Actions run the playwright suite is held against.
  constructor(tables, loader, roleInfo, cardHost, container, runs) {
    super(tables, loader, roleInfo);
    this.cardHost = cardHost;
    this.container = container;
    this.runs = runs;
    this.root = el('div', { className: 'table-section' });
    this.section = false;
    this.loaded = null;
    this.lines = null;
    this.width = 0;
    this.runNote = '';
    this.onRun = null;
    /** @type {(promise: Promise<unknown>, label: () => string) => unknown} */
    this.track = promise => promise;
    this.repaint = null;
  }

  // Many artifacts land within a moment of each other; one repaint covers them.
  _soon() {
    if (this.repaint) return;
    this.repaint = setTimeout(() => {
      this.repaint = null;
      this._paint();
    }, 200);
  }

  // Args:
  //   key: the Actions run to hold the suite against, as TestRuns.key() names
  //     it, or '' for none.
  //   known: the run itself when the caller already holds it.
  pickRun(key, known = null) {
    this.runNote = '';
    return this.runs.pick(key, this.roleInfo.graph.roles, known)
      .catch(error => { this.runNote = t('tests.run.failed', { message: error.message }); })
      .then(() => {
        this.refresh();
        if (this.onRun) this.onRun();
        this._prefetch();
      });
  }

  _prefetch() {
    if (!this.runs.run) return;
    const number = this.runs.run.run_number;
    this.track(this.runs.prefetch(() => this._soon()),
      () => t('loader.task.artifacts', { number, ...this.runs.progress() }));
  }

  _listRuns() {
    if (this.runs.runs || this.listing) return;
    this.listing = this.runs.list()
      .catch(error => { this.runNote = t('tests.run.failed', { message: error.message }); })
      .then(() => this.refresh());
  }

  setFilters(filters) {
    this.filters = filters || {};
    this.section = false;
  }

  setSort(kind) {
    this.sort = TestsView.SORTS[kind] ? kind : 'name';
    const select = byId('tests-sort', HTMLSelectElement);
    if (select) select.value = this.sort;
    this.refresh();
  }

  setGate(gate) {
    this.gate = TestsView.GATES[gate] ? gate : 'all';
    const select = byId('tests-gate', HTMLSelectElement);
    if (select) select.value = this.gate;
    this.refresh();
  }

  refresh() {
    if (this.suites) this._render();
    else if (this.section) this._paint();
  }

  invalidate() {
    this.section = false;
    this.loaded = null;
    this.runs.retry();
    this._prefetch();
  }

  // Args:
  //   kind: 'playwright' or 'cli', the menu entry that opened the view.
  // Returns: the promise for the suites, settled once the grid can draw.
  show(kind) {
    this.container.replaceChildren(this.root);
    const switched = kind !== this.kind;
    this.kind = kind;
    if (kind === 'playwright') this._listRuns();
    if (!this.section) {
      this.section = true;
      this.note = t('tests.reading');
      this.lines = null;
      this._paint();
      this.loaded = this._load();
    } else if (switched) {
      this.refresh();
    }
    return this.loaded;
  }

  _paint() {
    render(html`<${TestsGrid} view=${this} />`, this.root);
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
      this.note = t('tests.failed', { message: error.message });
      this._paint();
    });
  }

  _render() {
    const all = this.kind === 'cli' ? this._cliRows() : this._playwrightRows();
    const rows = this.gate === 'all' ? all : all.filter(row => row.gate === this.gate);
    this.lines = TestsView._lines(this._sorted(rows));
    this.note = [this._note(all, rows), this._runNote()].filter(Boolean).join(' ');
    this.width = this.lines.reduce((most, line) => Math.max(most, line.cells.length), 0);
    this.detail = new Map();
    for (const line of this.lines) {
      line.keys = line.cells.map(row => {
        const key = String(this.detail.size);
        this.detail.set(key, row);
        return key;
      });
    }
    this._paint();
  }

  _held() {
    return this.kind === 'playwright' && this.runs.run;
  }

  _runNote() {
    if (!this._held()) return this.runNote;
    const ran = this.lines.filter(line => this.runs.of(line.role, line.variant).length).length;
    return t('tests.run.ran', { ran, n: this.lines.length, number: this.runs.run.run_number });
  }

  _hover(event) {
    const cell = event.target.closest('[data-cell]');
    if (!cell) return;
    const row = this.detail.get(cell.dataset.cell);
    const box = cell.getBoundingClientRect();
    this.cardHost.show(
      `#test-${cell.dataset.cell}`,
      { x: box.left, y: box.bottom },
      () => {
        const card = TestsView.card(row, this.roleInfo, this._plan(row));
        if (this._held()) fillRun(card.appendChild(el('dl', { className: 'role-card-facts test-run' })), this.runs, row);
        return card;
      }
    );
  }

  _leave(event) {
    const cell = event.target.closest('[data-cell]');
    if (cell) this.cardHost.release(`#test-${cell.dataset.cell}`);
  }

  // Args:
  //   row: the cell's test row.
  //   plan: its meta/ci-order.json entry, or undefined when the sweep skips it.
  static card(row, roleInfo, plan) {
    const status = TestsView.STATUS[row.gate];
    const scalars = [
      [t('tests.card.variant'), row.variant === null ? t('tests.base') : String(row.variant)],
      [t('tests.gate'), status.title],
      [t('tests.card.rank'), plan ? String(plan.rank) : t('tests.card.undiscovered')],
      [t('tests.card.timeout'), row.timeout ? `${row.timeout}s` : ''],
      [t('tests.card.why'), (row.reasons || []).join('; ')],
    ].filter(([, value]) => value);
    const lists = [
      [t('tests.card.skip'), row.skip, true],
      [t('tests.card.branch'), row.branch, true],
      [t('tests.card.flags'), row.flags, false],
      [t('tests.card.shared'), row.shared, false],
    ].filter(([, items]) => items && items.length);
    return toElement(html`
      <div class="role-card test-card">
        <div class="role-card-title">${roleInfo.icon(row.role)}${` ${status.mark} ${row.role}`}</div>
        <p class="role-card-desc">${row.test}</p>
        <dl class="role-card-facts">
          ${scalars.map(([term, value]) => html`<dt>${term}</dt><dd>${value}</dd>`)}
          ${lists.map(([term, items, services]) => html`
            <dt>${term}</dt>
            <dd class="chips">${items.map(item => (services ? roleInfo.chip(item) : html`<span class="chip">${item}</span>`))}</dd>
          `)}
        </dl>
      </div>
    `);
  }
}

