class MetaRegistry {
  constructor(metaByRole, categoriesTree) {
    this.meta = metaByRole;
    this.roles = Object.keys(metaByRole).sort();
    this.categoryPaths = MetaRegistry._flatten(categoriesTree)
      .map(c => c.toLowerCase())
      .sort((a, b) => b.length - a.length);
    this.applications = this._applications();
    this.registry = this._registry();
  }

  static _flatten(tree, prefix = '') {
    const out = [];
    for (const [key, value] of Object.entries(tree || {})) {
      const current = prefix ? `${prefix}-${key}` : key;
      out.push(current);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue && typeof subValue === 'object' && !Array.isArray(subValue)) {
            out.push(...MetaRegistry._flatten({ [subKey]: subValue }, current));
          }
        }
      }
    }
    return out;
  }

  static _map(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  static _name(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // A flag counts as a dependency when it is literally true or names a
  // group: the unrendered '{{ ... in group_names }}' form is true on some
  // node shape, and the static closure is the co-deploy superset.
  static _isExplicitTruth(value) {
    if (value === true) return true;
    return typeof value === 'string' && value.includes('in group_names');
  }

  entityName(roleName) {
    const lower = roleName.toLowerCase();
    let emptyMatch = false;
    for (const category of this.categoryPaths) {
      if (lower.startsWith(`${category}-`)) return roleName.slice(category.length + 1);
      if (lower === category) emptyMatch = true;
    }
    return emptyMatch ? '' : roleName;
  }

  _services(role) {
    return MetaRegistry._map(this.meta[role]?.services);
  }

  _applications() {
    const applications = {};
    for (const role of this.roles) {
      const applicationId = MetaRegistry._name(this.meta[role]?.vars?.application_id);
      if (!applicationId) continue;
      applications[applicationId] = { services: this._services(role) };
    }
    return applications;
  }

  _discover(applicationId, config) {
    const services = MetaRegistry._map(config.services);
    const entity = this.entityName(applicationId);
    const primary = MetaRegistry._map(services[entity]);
    const aliases = Object.entries(services).filter(
      ([, entry]) => MetaRegistry._name(MetaRegistry._map(entry).canonical) === entity
    );

    let provides = MetaRegistry._name(primary.provides);
    if (provides === entity) provides = '';

    const isProvider =
      Object.keys(primary).length > 0 &&
      (Boolean(primary.shared) || 'provides' in primary || aliases.length > 0);
    if (!isProvider) return {};

    const primaryId = provides || entity;
    const covers = Array.isArray(primary.covers)
      ? primary.covers.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [];
    const base = {
      role: applicationId,
      entity_name: entity,
      shared: Boolean(primary.shared),
      enabled: Boolean(primary.enabled),
      covers,
    };
    if (provides) base.provides = provides;

    const discovered = { [primaryId]: base };
    for (const [aliasKey, aliasEntry] of aliases.sort((a, b) => a[0].localeCompare(b[0]))) {
      const alias = MetaRegistry._map(aliasEntry);
      discovered[aliasKey] = {
        ...base,
        canonical: primaryId,
        shared: Boolean(alias.shared),
        enabled: Boolean(alias.enabled),
      };
    }
    return discovered;
  }

  _registry() {
    const registry = {};
    for (const applicationId of Object.keys(this.applications).sort()) {
      const discovered = this._discover(applicationId, this.applications[applicationId]);
      for (const [serviceKey, entry] of Object.entries(discovered)) {
        const existing = registry[serviceKey];
        if (existing && existing.role !== entry.role) {
          throw new Error(
            `Duplicate service key '${serviceKey}' is declared by both ` +
            `'${existing.role}' and '${entry.role}'.`
          );
        }
        registry[serviceKey] = entry;
      }
    }
    return registry;
  }

  providerOf(serviceKey) {
    return MetaRegistry._name(this.registry[serviceKey]?.role);
  }

  static parseBond(value) {
    if (typeof value === 'boolean' || value === null || value === undefined) return null;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  // A role whose name is exactly a category prefix strips to the empty string,
  // so the services key is the role name itself.
  primaryEntry(role) {
    const services = this.meta[role]?.services || {};
    return services[this.entityName(role)] || services[role] || {};
  }

  // Args:
  //   categories: the parsed meta/categories.yml roles tree.
  // Returns: the dash-joined paths whose node carries invokable: true, the
  //   same list plugins/filter/invokable_paths.py builds.
  static invokablePaths(categories) {
    const paths = [];
    const walk = (node, trail) => {
      if (!node || typeof node !== 'object') return;
      if (node.invokable === true && trail.length) paths.push(trail.join('-'));
      for (const [key, value] of Object.entries(node)) {
        if (key === 'invokable' || !value || typeof value !== 'object') continue;
        walk(value, [...trail, key]);
      }
    };
    walk(categories || {}, []);
    return paths.sort();
  }

  static isInvokable(role, paths) {
    return paths.some(path => role === path || role.startsWith(`${path}-`));
  }

  setVariants(raw) {
    this.variants = {};
    for (const [role, entries] of Object.entries(raw || {})) {
      if (Array.isArray(entries) && entries.length) this.variants[role] = entries;
    }
  }

  variantCount(role) {
    return this.variants?.[role]?.length || 0;
  }

  // meta/variants.yml holds overrides, not whole configs.
  variantServices(role, index) {
    const base = this._services(role);
    if (index === null || index === undefined) return base;
    const override = MetaRegistry._map(this.variants?.[role]?.[index]).services;
    return override ? MetaRegistry._deepMerge(base, override) : base;
  }

  variantAxis(participants) {
    const axis = [];
    for (const role of participants) {
      const count = this.variantCount(role);
      if (!count) {
        axis.push({ role, variant: null });
        continue;
      }
      for (let index = 0; index < count; index += 1) axis.push({ role, variant: index });
    }
    return axis;
  }

  static _deepMerge(base, override) {
    if (
      base && typeof base === 'object' && !Array.isArray(base) &&
      override && typeof override === 'object' && !Array.isArray(override)
    ) {
      const merged = { ...base };
      for (const [key, value] of Object.entries(override)) {
        merged[key] = MetaRegistry._deepMerge(merged[key], value);
      }
      return merged;
    }
    return override;
  }
}

window.MetaRegistry = MetaRegistry;
