import { el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';

const COLUMNS = ['kind', 'where', 'item'];
const RANK = { fixme: 0, hack: 1, xxx: 2, todo: 3, note: 4 };

function Table({ view }) {
  const rows = view.rows();
  const row = item => html`
    <tr>
      <td class=${`feed-mark todo-${item.kind}`}>${t(`todos.kind.${item.kind}`)}</td>
      <td class="todo-where">
        ${view.link(item)
          ? html`<a href=${view.link(item)} target="_blank" rel="noreferrer">${`${item.path}:${item.line}`}</a>`
          : `${item.path}:${item.line}`}
      </td>
      <td class="todo-item">${item.text}</td>
    </tr>
  `;
  return html`
    <h2>${t('view.itemsWith', { view: t('view.todos') })}</h2>
    <div class="feed-filters">
      <input type="search" class="form-control form-control-sm feed-search" value=${view.filters.search}
             placeholder=${t('feed.filter.search')} aria-label=${t('feed.filter.search')}
             onInput=${event => view.setFilter('search', event.currentTarget.value)} />
      <label class="feed-filter">
        <span>${t('todos.column.kind')}</span>
        <select class="form-select form-select-sm" data-filter="kind"
                onChange=${event => view.setFilter('kind', event.currentTarget.value)}>
          <option value="">${t('feed.filter.all')}</option>
          ${view.kinds().map(([kind, count]) => html`
            <option value=${kind} selected=${view.filters.kind === kind}>
              ${`${t(`todos.kind.${kind}`)} (${count})`}
            </option>
          `)}
        </select>
      </label>
    </div>
    <p class="table-note">${view.note}</p>
    <div class="table-scroll">
      ${view.items && html`
        <table class="table table-sm feed-table todo-table">
          <thead><tr>${COLUMNS.map(column => html`<th>${t(`todos.column.${column}`)}</th>`)}</tr></thead>
          <tbody>${rows.map(row)}</tbody>
        </table>
      `}
    </div>
  `;
}

export class TodosView {
  // Args:
  //   range: the GitRange, for the ref the list is read at and the repository
  //     each line links into.
  constructor(range, container) {
    this.range = range;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
    this.items = null;
    this.note = '';
    this.loaded = null;
    this.onFilter = null;
    /** @type {(promise: Promise<unknown>, label: () => string) => unknown} */
    this.track = promise => promise;
    this.filters = { search: '', kind: '' };
  }

  setFilter(name, value) {
    this.filters[name] = value || '';
    this._render();
    if (this.onFilter) this.onFilter();
  }

  // Returns: the line on GitHub, or '' while the mirror says nothing.
  link(item) {
    const catalog = this.range.catalog;
    if (!catalog) return '';
    return `https://github.com/${catalog.root}/blob/HEAD/${item.path}#L${item.line}`;
  }

  rows() {
    const search = this.filters.search.trim().toLowerCase();
    return (this.items || []).filter(item => (!this.filters.kind || item.kind === this.filters.kind)
      && (!search || `${item.path} ${item.text}`.toLowerCase().includes(search)));
  }

  // Returns: [[kind, count]] over everything read, the loudest marker first.
  kinds() {
    const counts = new Map();
    for (const item of this.items || []) counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
    return [...counts].sort((one, other) => (RANK[one[0]] ?? 9) - (RANK[other[0]] ?? 9));
  }

  invalidate() {
    this.items = null;
    this.loaded = null;
  }

  refresh() {
    if (this.items) this._render();
  }

  show() {
    this.container.replaceChildren(this.root);
    if (this.loaded) {
      this._render();
      return this.loaded;
    }
    this.note = t('todos.reading');
    this.items = null;
    this._paint();
    this.loaded = this.track(
      fetch('/git/todos')
        .then(answer => (answer.ok ? answer.json() : Promise.reject(new Error(`HTTP ${answer.status}`))))
        .then(body => {
          this.items = body.items || [];
          this.capped = Boolean(body.capped);
          this._render();
          return this.items;
        })
        .catch(error => {
          this.note = t('todos.failed', { message: error.message });
          this._paint();
          return [];
        }),
      () => t('todos.reading')
    );
    return this.loaded;
  }

  _render() {
    const all = this.items || [];
    const rows = this.rows();
    const files = new Set(all.map(item => item.path));
    this.note = [
      t('todos.note', { n: all.length, files: files.size }),
      rows.length === all.length ? '' : t('feed.filter.shown', { n: rows.length }),
      this.capped ? t('todos.capped') : '',
    ].filter(Boolean).join(' ');
    this._paint();
  }

  _paint() {
    render(html`<${Table} view=${this} />`, this.root);
  }
}
