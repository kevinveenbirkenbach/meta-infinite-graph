// metaGraph.js
//
// Derives the role graph from the scanned meta/*.yml data.
//
// Edge kinds:
//   dependency       this role consumes another role's service: a service
//                    flag names it ('<role>' in group_names) or the service
//                    key matches the other role's `provides` name
//   run_after        deploy-ordering flow from meta/services.yml run_after
//   role_dependency  Ansible dependency from meta/main.yml dependencies
//
// A consumption whose enabled/shared flag is a '{{ ... }}' template is
// `optional: true` (rendered dashed, 0..1).
export class MetaGraph {
  constructor(metaByRole) {
    this.meta = metaByRole;
    this.roles = Object.keys(metaByRole).sort();
    this.variantAware = false;
    this._buildIndex();
  }

  static _groupRefs(entry) {
    const refs = new Set();
    for (const flag of [entry.enabled, entry.shared]) {
      if (typeof flag === 'string') {
        for (const m of flag.matchAll(/'([a-z0-9][a-z0-9-]*)'\s+in\s+group_names/g)) {
          refs.add(m[1]);
        }
      }
    }
    return refs;
  }

  static _isOptional(entry) {
    return typeof entry.enabled === 'string' || typeof entry.shared === 'string';
  }

  _services(role) {
    const services = this.meta[role]?.services;
    return services && typeof services === 'object' ? services : {};
  }

  _buildIndex() {
    this.providesToRole = new Map();
    this.attributes = {};
    this.edges = [];

    for (const role of this.roles) {
      for (const entry of Object.values(this._services(role))) {
        if (entry && typeof entry === 'object' && typeof entry.provides === 'string') {
          this.providesToRole.set(entry.provides.trim(), role);
        }
      }
    }

    for (const role of this.roles) {
      const galaxy = this.meta[role]?.main?.galaxy_info || {};
      const services = this._services(role);
      const primary = Object.values(services).find(
        e => e && typeof e === 'object' && (e.lifecycle || e.provides || e.run_after)
      ) || {};
      this.attributes[role] = {
        author: galaxy.author || '',
        description: galaxy.description || '',
        license: galaxy.license || '',
        galaxy_tags: galaxy.galaxy_tags || [],
        lifecycle: primary.lifecycle || '',
        provides: primary.provides || '',
        modes: Object.entries(primary.modes || {})
          .filter(([, v]) => v && v.enabled !== false)
          .map(([mode]) => mode),
        services: Object.keys(services),
      };

      for (const [key, entry] of Object.entries(services)) {
        if (!entry || typeof entry !== 'object') continue;
        for (const ref of MetaGraph._groupRefs(entry)) {
          if (ref !== role && this.meta[ref]) {
            this._addEdge(role, ref, 'dependency', true, key);
          }
        }
        const provider = this.providesToRole.get(key);
        if (provider && provider !== role) {
          this._addEdge(role, provider, 'dependency', MetaGraph._isOptional(entry), key);
        }
        for (const after of entry.run_after || []) {
          if (this.meta[after]) this._addEdge(after, role, 'run_after', false, key);
        }
      }

      const deps = this.meta[role]?.main?.dependencies || [];
      for (const dep of deps) {
        const name = typeof dep === 'string' ? dep : dep?.role;
        if (name && name !== role && this.meta[name]) {
          this._addEdge(role, name, 'role_dependency', false, '');
        }
      }
    }
  }

  setVariants(raw) {
    this.variants = {};
    for (const [role, entries] of Object.entries(raw || {})) {
      if (Array.isArray(entries) && entries.length) this.variants[role] = entries;
    }
  }

  // Which variants of `role` keep the services entry `key` enabled. An empty
  // list on a role that declares variants means no variant deploys it.
  variantsEnabling(role, key) {
    const entries = this.variants?.[role];
    if (!entries) return null;
    const enabled = [];
    entries.forEach((entry, index) => {
      const override = entry?.services?.[key];
      const base = this._services(role)[key];
      const flag = override && 'enabled' in override ? override.enabled : base?.enabled;
      if (flag === true || (typeof flag === 'string' && flag.includes('in group_names'))) {
        enabled.push(index);
      }
    });
    return enabled;
  }

  _addEdge(source, target, kind, optional, via) {
    this._edgeKeys = this._edgeKeys || new Set();
    const key = `${source}|${target}|${kind}|${via}`;
    if (this._edgeKeys.has(key)) return;
    this._edgeKeys.add(key);
    this.edges.push({ source, target, kind, optional, via });
  }

  // Edges touching `role`, restricted to the enabled kinds/directions.
  // For dependency/role_dependency, source depends on target.
  neighborhood(role, { dependencies, dependents, runAfter, roleDependencies, roleDependents }) {
    const kept = this.edges.filter(e => {
      if (e.kind === 'dependency') {
        return (dependencies && e.source === role) || (dependents && e.target === role);
      }
      if (e.kind === 'run_after') {
        return runAfter && (e.source === role || e.target === role);
      }
      return (roleDependencies && e.source === role) || (roleDependents && e.target === role);
    });
    return this.variantAware ? this._annotateVariants(kept) : kept;
  }

  _annotateVariants(edges) {
    const out = [];
    for (const edge of edges) {
      if (edge.kind !== 'dependency' || !edge.via) {
        out.push(edge);
        continue;
      }
      const enabling = this.variantsEnabling(edge.source, edge.via);
      if (enabling === null) {
        out.push(edge);
        continue;
      }
      if (enabling.length) out.push({ ...edge, variants: enabling });
    }
    return out;
  }

  // Weight = number of graph edges touching the role (dependencies +
  // dependents + run_after + ansible deps), the same "busiest role" notion
  // the complexity CLI sorts by.
  weight(role) {
    if (!this._weights) {
      this._weights = {};
      for (const r of this.roles) this._weights[r] = 0;
      for (const e of this.edges) {
        this._weights[e.source] = (this._weights[e.source] || 0) + 1;
        this._weights[e.target] = (this._weights[e.target] || 0) + 1;
      }
    }
    return this._weights[role] || 0;
  }

  rolesByWeight() {
    return [...this.roles].sort((a, b) => this.weight(b) - this.weight(a));
  }

  heaviestRole() {
    return this.rolesByWeight()[0];
  }

  node(role) {
    return { id: role, weight: this.weight(role), ...this.attributes[role] };
  }

  facets() {
    const collect = key => {
      const values = new Map();
      for (const role of this.roles) {
        const value = this.attributes[role][key];
        for (const v of Array.isArray(value) ? value : [value]) {
          if (v) values.set(v, (values.get(v) || 0) + 1);
        }
      }
      return [...values.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      author: collect('author'),
      lifecycle: collect('lifecycle'),
      modes: collect('modes'),
    };
  }

  matches(role, filters) {
    const attrs = this.attributes[role];
    if (filters.author && attrs.author !== filters.author) return false;
    if (filters.lifecycle && attrs.lifecycle !== filters.lifecycle) return false;
    if (filters.mode && !attrs.modes.includes(filters.mode)) return false;
    return true;
  }
}
