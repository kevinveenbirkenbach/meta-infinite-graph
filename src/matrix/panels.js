import { el } from '../dom.js';
import { html, render, useState } from '../html.js';
import { t } from '../i18n.js';
import { chrome, onEscape } from '../popup.js';
import { MatrixModel } from './model.js';

export class MatrixPanels {
  constructor(matrix) {
    this.matrix = matrix;
    this.picked = null;
    this._outside = null;
    this._escape = null;
  }

  // Args:
  //   framed: true gives the panel the shared minimize, maximize and close
  //     controls; a menu closes by picking from it and takes none.
  _float(className, x, y, vnode, framed = false) {
    this.close();
    const panel = el('div', { className: `${className} matrix-float` });
    document.body.appendChild(panel);
    // A framed panel renders into a body of its own: repainting the panel
    // itself would take the control bar with it.
    render(vnode, framed ? panel.appendChild(el('div', { className: 'popup-body' })) : panel);
    if (framed) chrome(panel, { onClose: () => this.close() });
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    this._outside = event => {
      if (!panel.contains(event.target)) this.close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._outside);
      this._escape = onEscape(() => this.close());
    });
    return panel;
  }

  close() {
    this.picked = null;
    for (const open of document.querySelectorAll('.matrix-float')) {
      render(null, open);
      open.remove();
    }
    if (this._outside) document.removeEventListener('mousedown', this._outside);
    if (this._escape) this._escape();
    this._outside = null;
    this._escape = null;
  }

  detail(row, id, x, y) {
    const variant = row.variant !== null && row.variant !== undefined ? ` #${row.variant}` : '';
    const value = this.matrix.model.value(row, id);
    this._float('matrix-detail', x, y, html`
      <div class="matrix-detail-title">${`${row.name}${variant} · ${id}`}</div>
      <pre>${typeof value === 'object' && value !== null
        ? jsyaml.dump(value, { lineWidth: 100 }).trimEnd()
        : String(value)}</pre>
    `, true);
  }

  menu(id, x, y, rows) {
    this._float('matrix-menu dropdown-menu show', x, y, html`<${ColumnMenu} panels=${this} id=${id} rows=${rows} />`);
  }

  picker(x, y) {
    this.picked = this._float('matrix-picker', x, y, html`<${Picker} panels=${this} />`, true);
    this.picked.querySelector('input').focus();
  }

  repaintPicker() {
    if (this.picked) render(html`<${Picker} panels=${this} />`, this.picked.querySelector('.popup-body'));
  }

  // Args:
  //   host: the element to fill; the design panel's list and the popover at the
  //     table both render through here.
  //   needle: narrows the list to columns whose path contains it.
  list(host, needle) {
    if (!host) return;
    render(this.matrix.model.meta
      ? html`<${ColumnList} matrix=${this.matrix} needle=${needle} />`
      : t('matrix.openFirst'), host);
  }

  // Returns: the lines written, header first.
  download() {
    const { matrix } = this;
    const columns = matrix.visible();
    const rows = matrix.model.rows(columns, matrix.find, matrix.sort);
    const quote = text => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const lines = [columns.map(quote).join(',')];
    for (const row of rows) {
      lines.push(columns.map(id => quote(matrix.model.display(row, id))).join(','));
    }
    const link = el('a', {
      href: URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })),
      download: 'mig-matrix.csv',
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href));
    return lines;
  }
}

function ColumnMenu({ panels, id, rows }) {
  const { matrix } = panels;
  const [needle, setNeedle] = useState('');
  const item = (text, action, disabled) => html`
    <button type="button" class="dropdown-item" disabled=${disabled} onClick=${() => { panels.close(); action(); }}>${text}</button>
  `;
  const { common, rare } = matrix.model.children(id, rows);
  const parent = MatrixModel.parent(id);
  const hidden = matrix.model.search(needle, matrix.columns).filter(column => !matrix.columns.includes(column));
  return html`
    ${item(t('matrix.sortAsc'), () => matrix.setSort(id, 'asc'), false)}
    ${item(t('matrix.sortDesc'), () => matrix.setSort(id, 'desc'), false)}
    ${item(t('matrix.unfoldCommon', { n: common.length }), () => matrix.expand(id, false), !common.length)}
    ${rare.length ? item(t('matrix.unfoldAll', { n: common.length + rare.length, rare: rare.length }), () => matrix.expand(id, true), false) : null}
    ${item(t('matrix.foldInto', { parent: parent || t('matrix.itsParent') }), () => matrix.collapse(id), !parent)}
    ${item(t('matrix.remove'), () => matrix.remove(id), id === 'role')}
    <div class="dropdown-divider"></div>
    <input type="search" class="form-control form-control-sm" placeholder=${t('matrix.addColumn')}
           value=${needle} onInput=${event => setNeedle(event.currentTarget.value)} />
    <div class="matrix-menu-list">
      ${hidden.slice(0, 80).map(column => item(column, () => matrix.add(column, id), false))}
      ${hidden.length > 80 && html`<div class="dropdown-item-text small">${t('matrix.more', { n: hidden.length - 80 })}</div>`}
    </div>
  `;
}

function Picker({ panels }) {
  const { matrix } = panels;
  const [needle, setNeedle] = useState('');
  return html`
    <div class="d-flex gap-1 mb-1">
      <input type="search" class="form-control form-control-sm" placeholder=${t('matrix.filterColumns')}
             value=${needle} onInput=${event => setNeedle(event.currentTarget.value)} />
      <button type="button" class="btn btn-sm btn-outline-primary"
              onClick=${() => matrix.setColumns([...MatrixModel.DEFAULT])}>${t('matrix.default')}</button>
    </div>
    <div class="matrix-columns"><${ColumnList} matrix=${matrix} needle=${needle} /></div>
  `;
}

function ColumnList({ matrix, needle }) {
  const groups = new Map();
  for (const id of matrix.model.search(needle, matrix.columns)) {
    const group = id.split('.')[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
  }
  return [...groups].map(([group, ids]) => html`
    <div class="matrix-columns-group">${group}</div>
    ${ids.map(id => html`
      <label class="matrix-columns-row">
        <input type="checkbox" data-column=${id} checked=${matrix.columns.includes(id)} disabled=${id === 'role'}
               onChange=${event => (event.currentTarget.checked ? matrix.add(id) : matrix.remove(id))} />
        ${` ${id}`}
        ${id !== 'role' && matrix.model.distinct(id) <= 1 && html`
          <span class="matrix-const" title=${t('matrix.constantTitle')}>${t('matrix.constant')}</span>
        `}
      </label>
    `)}
  `);
}
