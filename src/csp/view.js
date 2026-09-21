import { el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { CspScan } from './model.js';

const COLUMNS = ['kind', 'role', 'directive', 'source', 'reason'];

function Table({ view }) {
  const rows = view.rows();
  const row = entry => html`
    <tr>
      <td class=${`feed-mark csp-${entry.kind}`}>${CspView.kindLabel(entry.kind)}</td>
      <td data-role-name=${entry.role}>${view.roleInfo.labelNode(entry.role)}</td>
      <td class="csp-directive">${entry.directive}</td>
      <td class="csp-source">${entry.source}</td>
      <td class="csp-reason">${entry.reason}</td>
    </tr>
  `;
  return html`
    <h2>${t('view.securityWith', { view: t('view.csp') })}</h2>
    <div class="feed-filters">
      <input type="search" class="form-control form-control-sm feed-search" value=${view.filters.search}
             placeholder=${t('feed.filter.search')} aria-label=${t('feed.filter.search')}
             onInput=${event => view.setFilter('search', event.currentTarget.value)} />
      <label class="feed-filter">
        <span>${t('csp.column.kind')}</span>
        <select class="form-select form-select-sm" data-filter="kind"
                onChange=${event => view.setFilter('kind', event.currentTarget.value)}>
          <option value="">${t('feed.filter.all')}</option>
          ${view.kinds().map(([kind, count]) => html`
            <option value=${kind} selected=${view.filters.kind === kind}>
              ${`${CspView.kindLabel(kind)} (${count})`}
            </option>
          `)}
        </select>
      </label>
    </div>
    <p class="table-note">${view.note}</p>
    <div class="table-scroll">
      ${view.scan.found && html`
        <table class="table table-sm feed-table csp-table">
          <thead><tr>${COLUMNS.map(column => html`<th>${t(`csp.column.${column}`)}</th>`)}</tr></thead>
          <tbody>${rows.map(row)}</tbody>
        </table>
      `}
    </div>
  `;
}

export class CspView {
  // Args:
  //   scan: the CspScan reading every role's meta/csp.yml.
  //   roleInfo: for the role label, so a role reads as it does everywhere else.
  constructor(scan, roleInfo, container) {
    this.scan = scan;
    this.roleInfo = roleInfo;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
    this.note = '';
    this.loaded = null;
    this.onFilter = null;
    /** @type {(promise: Promise<unknown>, label: () => string) => unknown} */
    this.track = promise => promise;
    this.filters = { search: '', kind: '' };
  }

  // Returns: the word for a class this app named, or the token the role wrote.
  static kindLabel(kind) {
    return CspScan.classified(kind) ? t(`csp.kind.${kind}`) : kind;
  }

  setFilter(name, value) {
    this.filters[name] = value || '';
    this._render();
    if (this.onFilter) this.onFilter();
  }

  rows() {
    const search = this.filters.search.trim().toLowerCase();
    return (this.scan.found || []).filter(entry => (!this.filters.kind || entry.kind === this.filters.kind)
      && (!search || [entry.role, entry.directive, entry.source, entry.reason]
        .some(value => String(value || '').toLowerCase().includes(search))));
  }

  // Returns: [[kind, count]] over everything found, worst first.
  kinds() {
    const counts = new Map();
    for (const entry of this.scan.found || []) counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
    return [...counts].sort((one, other) => CspScan.rank({ kind: one[0] }) - CspScan.rank({ kind: other[0] }));
  }

  invalidate() {
    this.scan.found = null;
    this.loaded = null;
  }

  refresh() {
    if (this.scan.found) this._render();
  }

  // Returns: the promise for the scan, settled once every role was read.
  show() {
    this.container.replaceChildren(this.root);
    if (this.loaded) {
      this._render();
      return this.loaded;
    }
    this.note = t('csp.reading');
    this._paint();
    const roles = this.roleInfo.graph.roles;
    let done = 0;
    this.loaded = this.track(
      this.scan.read(roles, () => { done += 1; }).then(() => {
        this._render();
        return this.scan.found;
      }),
      () => t('csp.progress', { done, total: roles.length })
    );
    return this.loaded;
  }

  _render() {
    const all = this.scan.found || [];
    const rows = this.rows();
    const roles = new Set(all.map(entry => entry.role));
    this.note = [
      t('csp.note', { n: all.length, roles: roles.size }),
      rows.length === all.length ? '' : t('feed.filter.shown', { n: rows.length }),
    ].filter(Boolean).join(' ');
    this._paint();
  }

  _paint() {
    render(html`<${Table} view=${this} />`, this.root);
  }
}
