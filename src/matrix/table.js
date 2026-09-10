import { html } from '../html.js';
import { t } from '../i18n.js';
import { TableView } from '../table/view.js';
import { MatrixModel } from './model.js';
import { MatrixPointer } from './pointer.js';

export class MatrixTable {
  static CHIPS = 6;

  constructor(matrix) {
    this.matrix = matrix;
  }

  width(id) {
    if (this.matrix.widths[id]) return this.matrix.widths[id];
    if (id === 'role') return 200;
    if (id === 'variant') return 70;
    return MatrixModel.computed(id) ? 110 : 180;
  }

  // A fixed table spreads any width beyond its columns over all of them, and
  // max-content would measure every unbroken description; only an explicit sum
  // leaves each column the width it was given.
  static fit(table) {
    const cols = [...table.querySelectorAll('col')];
    table.style.width = `${cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0)}px`;
  }

  note(rows, columns) {
    const total = this.matrix.model.allRows().length;
    const shown = rows.length === total
      ? t('matrix.noteRows', { n: rows.length })
      : t('matrix.noteRowsOf', { n: rows.length, total });
    const all = this.matrix.model.catalogue(this.matrix.columns).length;
    return `${shown}, ${t('matrix.noteColumns', { n: columns.length, all })} ${t('matrix.noteHelp')}`;
  }

  grid(rows, columns) {
    const groups = [];
    for (const id of columns) {
      const group = MatrixModel.parent(id) || (id.includes('.') ? id.split('.')[0] : '');
      const last = groups[groups.length - 1];
      if (last && group && last.group === group) last.span += 1;
      else groups.push({ group, span: 1 });
    }
    const total = columns.reduce((sum, id) => sum + this.width(id), 0);
    return html`
      <table class=${`table table-sm role-matrix density-${this.matrix.density}`} style=${{ width: `${total}px` }}>
        <colgroup>
          ${columns.map(id => html`<col data-column=${id} style=${{ width: `${this.width(id)}px` }} />`)}
        </colgroup>
        <thead>
          <tr class="matrix-groups">
            ${groups.map(({ group, span }) => html`<th data-group=${group} colSpan=${span}>${group}</th>`)}
          </tr>
          <tr class="matrix-keys">${columns.map(id => this._head(id, rows))}</tr>
        </thead>
        <tbody>${rows.map(row => html`<tr>${columns.map(id => this._cell(row, id))}</tr>`)}</tbody>
      </table>
    `;
  }

  _head(id, rows) {
    const { matrix } = this;
    const { model, sort } = matrix;
    const leaf = MatrixModel.computed(id) ? id.split('.').slice(1).join('.') : id.split('.').pop();
    const { common, rare } = model.children(id, rows);
    const at = sort.findIndex(key => key.id === id);
    const dir = at >= 0 ? sort[at].dir : null;
    const filled = id !== 'role' && id !== 'variant' && rows.length
      ? rows.filter(row => !MatrixModel.empty(model.value(row, id))).length
      : null;
    const stop = event => event.stopPropagation();
    const parts = html`
      ${(common.length || rare.length) ? html`
        <span class="matrix-unfold" title=${t('matrix.unfoldTitle', { id, n: common.length })}
              onClick=${event => { stop(event); matrix.expand(id, !common.length); }}>▸</span>
      ` : null}
      <span class="matrix-label">${leaf}</span>
      ${dir && html`<span class="matrix-sorted">${dir === 'asc' ? '▲' : '▼'}${sort.length > 1 ? at + 1 : ''}</span>`}
      ${filled !== null && html`
        <span class="matrix-fill" title=${t('matrix.fillTitle', { filled, n: rows.length })}>
          ${`${Math.round((filled / rows.length) * 100)}%`}
        </span>
      `}
    `;
    const ariaSort = dir && (dir === 'asc' ? 'ascending' : 'descending');
    if (id === 'variant') {
      return html`<th title=${id} data-column=${id} aria-sort=${ariaSort || undefined}>${parts}</th>`;
    }
    return html`
      <th title=${id} data-column=${id} aria-sort=${ariaSort || undefined}
          onMouseDown=${event => MatrixPointer.press(matrix, event, id)}
          onContextMenu=${event => { event.preventDefault(); matrix.panels.menu(id, event.clientX, event.clientY, rows); }}>
        ${parts}
        <button type="button" class="matrix-more" title=${t('matrix.columnMenu')} onClick=${event => {
          stop(event);
          const box = event.currentTarget.getBoundingClientRect();
          matrix.panels.menu(id, box.left, box.bottom, rows);
        }}>⋮</button>
        <span class="matrix-resize" title=${t('matrix.dragToWiden')} onClick=${stop}
              onMouseDown=${event => MatrixPointer.widen(matrix, event, id, event.currentTarget.closest('th'))}></span>
      </th>
    `;
  }

  static _chips(items, make) {
    return html`
      ${items.slice(0, MatrixTable.CHIPS).map(make)}
      ${items.length > MatrixTable.CHIPS && html`
        <span class="chip matrix-more-chips">${`+${items.length - MatrixTable.CHIPS}`}</span>
      `}
    `;
  }

  _content(row, id, value) {
    const { model, tableView } = this.matrix;
    const { roleInfo } = tableView;
    if (id === 'complexity.siblings') {
      return ['role-list', value.map((role, index) => html`
        <span data-role-name=${role}>${roleInfo.labelNode(role)}</span>
        ${!roleInfo.symbols && index < value.length - 1 ? ', ' : null}
      `)];
    }
    if (typeof value === 'boolean') {
      return roleInfo.symbols
        ? ['bool', html`<i class=${value ? 'fa-solid fa-check' : 'fa-solid fa-xmark'}></i>`, t(value ? 'common.yes' : 'common.no')]
        : ['', t(value ? 'common.yes' : 'common.no')];
    }
    if (id in MatrixModel.RESSOURCES || typeof value === 'number') return ['num', model.display(row, id)];
    if (id === 'services' && MatrixModel.isMap(value)) {
      return ['matrix-chips', MatrixTable._chips(Object.keys(value), key => roleInfo.chip(key))];
    }
    if (id === 'main.dependencies' && Array.isArray(value)) {
      return ['matrix-chips', MatrixTable._chips(value.map(String), role => html`
        <span class="chip service" data-role-name=${role}>${role}</span>
      `)];
    }
    if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) {
      return ['matrix-chips', MatrixTable._chips(value.map(String), item => html`<span class="chip">${item}</span>`)];
    }
    const text = MatrixModel.text(value);
    return ['matrix-text', text, text];
  }

  _cell(row, id) {
    const { model, tableView, cards, panels } = this.matrix;
    const value = model.value(row, id);
    if (id === 'role') {
      const pin = event => {
        const box = event.currentTarget.getBoundingClientRect();
        cards.pin(row.name, () => ({ x: box.right, y: box.top }));
      };
      return html`
        <td class="matrix-role" data-role-name=${row.name} onClick=${pin}>${tableView.roleInfo.labelNode(row.name)}</td>
      `;
    }
    if (id === 'variant') return html`<td class="num">${TableView._fmtVariant(value)}</td>`;
    if (MatrixModel.empty(value)) return html`<td class="matrix-empty">·</td>`;

    const [className, content, title] = this._content(row, id, value);
    const open = event => {
      if (event.target.closest('[data-role-name]')) return;
      const cell = event.currentTarget;
      const structured = value !== null && typeof value === 'object';
      if (!structured && cell.scrollWidth <= cell.clientWidth) return;
      panels.detail(row, id, event.clientX, event.clientY);
    };
    return html`
      <td class=${className ? `${className} matrix-value` : 'matrix-value'} title=${title} onClick=${open}>${content}</td>
    `;
  }
}
