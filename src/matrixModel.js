// Every value under each role's meta/, one row per role. A column is a dotted
// path; the catalogue offers one per file and top-level key, and a column
// whose values are maps unfolds into its keys.
class MatrixModel {
  // Chosen by how much they tell apart: license is one value for every role
  // and author nearly so, which is why neither is here.
  static DEFAULT = [
    'role', 'complexity.lifecycle', 'main.galaxy_info.description',
    'main.galaxy_info.galaxy_tags', 'services', 'main.dependencies', 'complexity.weight',
    'complexity.consumers', 'ressources.cpus', 'ressources.mem_limit', 'info.homepage', 'variants',
  ];

  static COMPLEXITY = [
    'complexity.lifecycle', 'complexity.embeds', 'complexity.consumers',
    'complexity.embeds_direct', 'complexity.consumers_direct', 'complexity.weight',
    'complexity.integrated', 'complexity.clone', 'complexity.siblings',
  ];

  static RESSOURCES = Object.fromEntries(RoleResources.METRICS.map(metric => [metric.column, metric]));

  static PRESETS = {
    overview: ['Overview', MatrixModel.DEFAULT],
    galaxy: ['Galaxy', [
      'role', 'main.galaxy_info.description', 'main.galaxy_info.galaxy_tags',
      'main.galaxy_info.author', 'main.galaxy_info.company', 'main.galaxy_info.license',
      'main.galaxy_info.min_ansible_version', 'main.galaxy_info.platforms', 'main.dependencies',
    ]],
    ressources: ['Ressources', ['role', 'services', ...Object.keys(MatrixModel.RESSOURCES)]],
    network: ['Network', ['role', 'domains', 'networks', 'server', 'csp', 'volumes']],
  };

  // Args:
  //   tableView: the TableView whose facet filters and variant switch apply.
  //   loader: reads the meta/ files, once, the first time they are asked for.
  constructor(tableView, loader) {
    this.tableView = tableView;
    this.tables = tableView.tables;
    this.loader = loader;
    this.meta = null;
    this._loading = null;
    this._totals = new Map();
    this._distinct = new Map();
    this._deepIds = null;
  }

  static isMap(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  static empty(value) {
    return value === null || value === undefined || value === ''
      || (Array.isArray(value) && !value.length)
      || (MatrixModel.isMap(value) && !Object.keys(value).length);
  }

  static text(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(MatrixModel.text).join(', ');
    if (MatrixModel.isMap(value)) {
      const entries = Object.entries(value);
      return entries.some(([, inner]) => inner !== null && typeof inner === 'object')
        ? entries.map(([key]) => key).join(', ')
        : entries.map(([key, inner]) => `${key}: ${MatrixModel.text(inner)}`).join(', ');
    }
    return String(value);
  }

  // Returns: true for a column MIG derives rather than reads from a meta file.
  static computed(id) {
    return id.startsWith('complexity.') || id in MatrixModel.RESSOURCES;
  }

  static parent(id) {
    const cut = id.lastIndexOf('.');
    const parent = cut > 0 ? id.slice(0, cut) : null;
    return parent === 'complexity' || parent === 'ressources' ? null : parent;
  }

  load() {
    if (this.meta) return Promise.resolve(this.meta);
    if (!this._loading) {
      this._loading = this.loader.loadMetaTree(this.tableView.roleInfo.graph.roles)
        .then(meta => {
          this.meta = meta;
          return meta;
        });
    }
    return this._loading;
  }

  allRows() {
    const byName = new Map();
    for (const row of this.tables.complexityRows(this.tableView.variantAware)) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row);
    }
    const rows = [];
    for (const name of Object.keys(this.meta).sort()) {
      if (!this.tableView._keeps(name)) continue;
      rows.push(...(byName.get(name) || [{ name, variant: null }]));
    }
    return rows;
  }

  rows(columns, find, sort) {
    const needle = find.trim().toLowerCase();
    return this.allRows()
      .filter(row => !needle || columns.some(id => this.display(row, id).toLowerCase().includes(needle)))
      .sort((one, other) => this.compare(one, other, sort));
  }

  value(row, id) {
    if (id === 'role') return row.name;
    if (id === 'variant') return row.variant;
    if (id.startsWith('complexity.')) return row[id.slice('complexity.'.length)];
    if (id in MatrixModel.RESSOURCES) {
      if (!this._totals.has(row.name)) {
        this._totals.set(row.name, this.tables.resourcesOf(row.name).totals);
      }
      const totals = this._totals.get(row.name);
      return totals ? totals[MatrixModel.RESSOURCES[id].key] : null;
    }
    const [file, ...path] = id.split('.');
    let value = file === 'services' && row.variant !== null && row.variant !== undefined
      ? this.tables.variantServices(row.name, row.variant)
      : (this.meta[row.name] || {})[file];
    for (const key of path) {
      if (!MatrixModel.isMap(value)) return undefined;
      value = value[key];
    }
    return value;
  }

  // Returns: the text a search matches and the CSV carries, ressources in the
  //   units the cells show them in rather than raw bytes.
  display(row, id) {
    const value = this.value(row, id);
    return id in MatrixModel.RESSOURCES
      ? MatrixModel.RESSOURCES[id].format(value)
      : MatrixModel.text(value);
  }

  catalogue(columns) {
    const ids = new Set(['role', ...MatrixModel.COMPLEXITY, ...Object.keys(MatrixModel.RESSOURCES)]);
    for (const files of Object.values(this.meta || {})) {
      for (const [file, data] of Object.entries(files)) {
        if (MatrixModel.isMap(data)) for (const key of Object.keys(data)) ids.add(`${file}.${key}`);
        else ids.add(file);
      }
    }
    for (const id of columns) ids.add(id);
    return [...ids].sort((one, other) => (one === 'role' ? -1 : other === 'role' ? 1
      : one.localeCompare(other)));
  }

  // Every path down to the leaves, for a search: typing 'license' has to find
  // main.galaxy_info.license, which the browsable list only holds as part of
  // main.galaxy_info.
  _deep(columns) {
    if (!this._deepIds) {
      const ids = new Set(this.catalogue(columns));
      const walk = (value, path) => {
        if (!MatrixModel.isMap(value)) return;
        for (const [key, inner] of Object.entries(value)) {
          ids.add(`${path}.${key}`);
          walk(inner, `${path}.${key}`);
        }
      };
      for (const files of Object.values(this.meta || {})) {
        for (const [file, data] of Object.entries(files)) walk(data, file);
      }
      this._deepIds = [...ids].sort();
    }
    return this._deepIds;
  }

  search(needle, columns) {
    const wanted = needle.trim().toLowerCase();
    return wanted
      ? this._deep(columns).filter(id => id.toLowerCase().includes(wanted))
      : this.catalogue(columns);
  }

  distinct(id) {
    if (!this._distinct.has(id)) {
      const seen = new Set(this.allRows().map(row => MatrixModel.text(this.value(row, id))));
      this._distinct.set(id, seen.size);
    }
    return this._distinct.get(id);
  }

  // Returns: { common, rare } child ids. A key most roles never set would add
  // a column of empty cells, so only the ones in at least one in twenty rows
  // are common; the rest stay one menu entry away.
  children(id, rows) {
    if (id === 'role' || id === 'variant' || MatrixModel.computed(id)) return { common: [], rare: [] };
    const counts = new Map();
    for (const row of rows) {
      const value = this.value(row, id);
      if (!MatrixModel.isMap(value)) continue;
      for (const key of Object.keys(value)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const floor = Math.max(2, Math.ceil(rows.length / 20));
    const common = [];
    const rare = [];
    for (const key of [...counts.keys()].sort()) {
      (counts.get(key) >= floor ? common : rare).push(`${id}.${key}`);
    }
    return { common, rare };
  }

  compare(one, other, sort) {
    const key = (row, id) => {
      const value = this.value(row, id);
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return MatrixModel.text(value).toLowerCase();
    };
    const blank = value => value === '' || value === null || value === undefined;
    for (const { id, dir } of sort) {
      const left = key(one, id);
      const right = key(other, id);
      if (blank(left) !== blank(right)) return blank(left) ? 1 : -1;
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      if (order) return dir === 'desc' ? -order : order;
    }
    return one.name.localeCompare(other.name) || (one.variant || 0) - (other.variant || 0);
  }
}

window.MatrixModel = MatrixModel;
