class RoleResources {
  static METRICS = [
    {
      label: 'CPU', column: 'ressources.cpus', key: 'cpus_float',
      format: value => TableView._fmtNumber(value),
    },
    {
      label: 'Mem res.', column: 'ressources.mem_reservation', key: 'mem_reservation_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: 'Mem limit', column: 'ressources.mem_limit', key: 'mem_limit_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: 'Storage', column: 'ressources.min_storage', key: 'min_storage_bytes',
      format: value => TableView._fmtBytes(value),
    },
    {
      label: 'PIDs', column: 'ressources.pids_limit', key: 'pids_limit_int',
      format: value => TableView._fmtNumber(value),
    },
  ];

  // Args:
  //   tables: the MetaTables that collects and sums a role's service rows.
  //   chip: (serviceKey, role) -> the element a service row shows its name as.
  constructor(tables, chip) {
    this.tables = tables;
    this.chip = chip;
  }

  // Returns: the totals as dt/dd pairs, labelled like the card's other facts,
  //   or none when the role runs no service with a footprint.
  facts(role) {
    const { totals, rows } = this.tables.resourcesOf(role);
    if (!rows.length) return [];
    return RoleResources.METRICS.flatMap(({ label, key, format }) => {
      const definition = el('dd', { className: 'res-fact', textContent: format(totals[key]) });
      definition.dataset.metric = key;
      return [el('dt', { className: 'res-fact', textContent: label }), definition];
    });
  }

  table(role) {
    const { totals, rows } = this.tables.resourcesOf(role);
    if (!rows.length) return null;
    const table = el('table', { className: 'role-card-resources' });

    const head = table.createTHead().insertRow();
    head.appendChild(el('th', { textContent: 'Ressources' }));
    for (const { label } of RoleResources.METRICS) {
      head.appendChild(el('th', { className: 'num', textContent: label }));
    }

    const total = table.createTBody();
    total.className = 'res-total';
    const toggle = total.insertRow();
    toggle.tabIndex = 0;
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'mem, storage and pids are summed over the services, cpu is the maximum. '
      + 'Click to break them down per service.';
    const label = el('th', {
      textContent: `▸ ${rows.length} ${rows.length === 1 ? 'service' : 'services'}`,
    });
    toggle.appendChild(label);
    for (const { key, format } of RoleResources.METRICS) {
      const cell = toggle.insertCell();
      cell.className = 'num';
      cell.dataset.metric = key;
      cell.textContent = format(totals[key]);
    }

    const services = table.createTBody();
    services.className = 'res-services';
    services.hidden = true;
    for (const row of rows) {
      const line = services.insertRow();
      const service = line.insertCell();
      service.appendChild(this.chip(row.service, row.role));
      service.style.paddingLeft = `${(row.depth - 1) * 0.9 + 0.8}em`;
      for (const { key, format } of RoleResources.METRICS) {
        const cell = line.insertCell();
        cell.className = 'num';
        cell.textContent = format(row[key]);
      }
    }

    const flip = () => {
      services.hidden = !services.hidden;
      toggle.setAttribute('aria-expanded', String(!services.hidden));
      label.textContent = `${services.hidden ? '▸' : '▾'}${label.textContent.slice(1)}`;
    };
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      flip();
    });
    return table;
  }
}

window.RoleResources = RoleResources;
