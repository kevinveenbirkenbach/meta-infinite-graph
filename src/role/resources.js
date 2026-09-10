import { html, useState } from '../html.js';
import { t } from '../i18n.js';
import { TableView } from '../table/view.js';

export class RoleResources {
  static METRICS = [
    {
      label: t('resources.cpu'), column: 'ressources.cpus', key: 'cpus_float',
      format: value => TableView._fmtNumber(value),
    },
    {
      label: t('resources.memRes'), column: 'ressources.mem_reservation', key: 'mem_reservation_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: t('resources.memLimit'), column: 'ressources.mem_limit', key: 'mem_limit_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: t('resources.storage'), column: 'ressources.min_storage', key: 'min_storage_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: t('resources.pids'), column: 'ressources.pids_limit', key: 'pids_limit_int',
      format: value => TableView._fmtNumber(value),
    },
  ];

  // Args:
  //   tables: the MetaTables that collects and sums a role's service rows.
  //   chip: (serviceKey, role) -> the vnode a service row shows its name as.
  constructor(tables, chip) {
    this.tables = tables;
    this.chip = chip;
  }

  // Returns: the totals as dt/dd pairs, labelled like the card's other facts,
  //   or none when the role runs no service with a footprint.
  facts(role) {
    const { totals, rows } = this.tables.resourcesOf(role);
    if (!rows.length) return [];
    return RoleResources.METRICS.map(({ label, key, format }) => html`
      <dt class="res-fact">${label}</dt>
      <dd class="res-fact" data-metric=${key}>${format(totals[key])}</dd>
    `);
  }

  table(role) {
    const { totals, rows } = this.tables.resourcesOf(role);
    if (!rows.length) return null;
    return html`<${ResourceTable} totals=${totals} rows=${rows} chip=${this.chip} />`;
  }
}

function ResourceTable({ totals, rows, chip }) {
  const [open, setOpen] = useState(false);
  const flip = () => setOpen(!open);
  const keydown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    flip();
  };
  return html`
    <table class="role-card-resources">
      <thead><tr>
        <th>${t('resources.title')}</th>
        ${RoleResources.METRICS.map(({ label }) => html`<th class="num">${label}</th>`)}
      </tr></thead>
      <tbody class="res-total">
        <tr tabindex="0" role="button" aria-expanded=${String(open)} onClick=${flip} onKeyDown=${keydown}
            title=${t('resources.toggleTitle')}>
          <th>${open ? '▾' : '▸'} ${t('resources.services', { n: rows.length })}</th>
          ${RoleResources.METRICS.map(({ key, format }) => html`
            <td class="num" data-metric=${key}>${format(totals[key])}</td>
          `)}
        </tr>
      </tbody>
      <tbody class="res-services" hidden=${!open}>
        ${rows.map(row => html`
          <tr>
            <td style=${{ paddingLeft: `${(row.depth - 1) * 0.9 + 0.8}em` }}>${chip(row.service, row.role)}</td>
            ${RoleResources.METRICS.map(({ key, format }) => html`<td class="num">${format(row[key])}</td>`)}
          </tr>
        `)}
      </tbody>
    </table>
  `;
}
