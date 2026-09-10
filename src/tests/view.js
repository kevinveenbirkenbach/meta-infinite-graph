import { CiOrder } from '../ciOrder.js';
import { byId, el } from '../dom.js';
import { html, render, toElement } from '../html.js';
import { PlaywrightMatrix } from '../playwrightMatrix.js';
import { TestsCatalog } from './catalog.js';

export class TestsView extends TestsCatalog {
  constructor(tables, loader, roleInfo, cardHost, container) {
    super(tables, loader, roleInfo);
    this.cardHost = cardHost;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
    this.section = false;
    this.loaded = null;
    this.lines = null;
    this.width = 0;
    this.onChange = null;
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

  setKind(kind) {
    this.kind = TestsView.KINDS[kind] ? kind : 'playwright';
    this.refresh();
  }

  refresh() {
    if (this.suites) this._render();
    else if (this.section) this._paint();
  }

  invalidate() {
    this.section = false;
    this.loaded = null;
  }

  show() {
    this.container.replaceChildren(this.root);
    if (!this.section) {
      this.section = true;
      this.note = 'Reading every role’s test suite…';
      this.lines = null;
      this._paint();
      this.loaded = this._load();
    }
  }

  _pick(value) {
    this.kind = value;
    this._render();
    if (this.onChange) this.onChange();
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
      this.note = `Could not read the test suites: ${error.message}`;
      this._paint();
    });
  }

  _render() {
    const all = this.kind === 'cli' ? this._cliRows() : this._playwrightRows();
    const rows = this.gate === 'all' ? all : all.filter(row => row.gate === this.gate);
    this.note = this._note(all, rows);
    this.lines = TestsView._lines(this._sorted(rows));
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

  _hover(event) {
    const cell = event.target.closest('[data-cell]');
    if (!cell) return;
    const row = this.detail.get(cell.dataset.cell);
    const box = cell.getBoundingClientRect();
    this.cardHost.show(
      `#test-${cell.dataset.cell}`,
      { x: box.left, y: box.bottom },
      () => TestsView.card(row, this.roleInfo, this._plan(row))
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
      ['Variant', row.variant === null ? 'base' : String(row.variant)],
      ['Gate', status.title],
      ['CI rank', plan ? String(plan.rank) : 'not discovered'],
      ['Timeout', row.timeout ? `${row.timeout}s` : ''],
      ['Why', (row.reasons || []).join('; ')],
    ].filter(([, value]) => value);
    const lists = [
      ['Skip gates', row.skip, true],
      ['Branch gates', row.branch, true],
      ['Env flags', row.flags, false],
      ['Shared harness', row.shared, false],
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

function TestsGrid({ view }) {
  const { lines, width } = view;
  const axis = label => html`<th class="tests-axis">${label}</th>`;
  const line = entry => {
    const plan = view._plan(entry);
    return html`
      <tr>
        <th class="tests-axis" data-role-name=${entry.role}>${view.roleInfo.labelNode(entry.role)}</th>
        ${axis(entry.variant === null ? 'base' : String(entry.variant))}
        <th class="tests-axis" title=${plan ? undefined : 'CI discovery does not deploy this role and variant'}>
          ${plan ? String(plan.rank) : ''}
        </th>
        ${Array.from({ length: width }, (_, index) => {
          const row = entry.cells[index];
          if (!row) return html`<td class="tests-blank"></td>`;
          return html`<td class=${`pw-${row.gate}`} data-cell=${entry.keys[index]}>${TestsView.STATUS[row.gate].mark}</td>`;
        })}
      </tr>
    `;
  };
  return html`
    <h2>Tests</h2>
    <div class="btn-group btn-group-sm tests-kind">
      ${Object.entries(TestsView.KINDS).map(([value, label]) => html`
        <input type="radio" class="btn-check" name="tests-kind" id=${`tests-kind-${value}`} value=${value}
               checked=${value === view.kind} onChange=${() => view._pick(value)} />
        <label class="btn btn-outline-primary" for=${`tests-kind-${value}`}>${label}</label>
      `)}
    </div>
    <p class="table-note">${view.note}</p>
    <div class="table-scroll">
      ${lines && html`
        <table class="tests-matrix" onMouseOver=${event => view._hover(event)} onMouseOut=${event => view._leave(event)}>
          <thead><tr>
            ${['role', 'variant', 'rank'].map(axis)}
            ${Array.from({ length: width }, (_, index) => html`<th>${String(index + 1)}</th>`)}
          </tr></thead>
          <tbody>${lines.map(line)}</tbody>
        </table>
      `}
    </div>
  `;
}
