// Ports of, and kept in sync with:
//   bond        cli.meta.roles.applications.bond
//   ressources  cli.meta.roles.applications.ressources
//   complexity  cli.meta.roles.applications.complexity
class MetaTables {
  constructor(metaByRole, categoriesTree) {
    this.meta = metaByRole;
    this.roles = Object.keys(metaByRole).sort();
    this.categoryPaths = MetaTables._flatten(categoriesTree)
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
            out.push(...MetaTables._flatten({ [subKey]: subValue }, current));
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
    return MetaTables._map(this.meta[role]?.services);
  }

  _applications() {
    const applications = {};
    for (const role of this.roles) {
      const applicationId = MetaTables._name(this.meta[role]?.vars?.application_id);
      if (!applicationId) continue;
      applications[applicationId] = { services: this._services(role) };
    }
    return applications;
  }

  _discover(applicationId, config) {
    const services = MetaTables._map(config.services);
    const entity = this.entityName(applicationId);
    const primary = MetaTables._map(services[entity]);
    const aliases = Object.entries(services).filter(
      ([, entry]) => MetaTables._name(MetaTables._map(entry).canonical) === entity
    );

    let provides = MetaTables._name(primary.provides);
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
      const alias = MetaTables._map(aliasEntry);
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
    return MetaTables._name(this.registry[serviceKey]?.role);
  }

  static parseBond(value) {
    if (typeof value === 'boolean' || value === null || value === undefined) return null;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  // {"consumer|provider": {bond, serviceKey, enabled}}. A role's entry
  // for its own entity is skipped: it carries unrelated topics such as users
  // or domains, not a bond to another role.
  bondEdges() {
    const edges = new Map();
    for (const consumer of this.roles) {
      for (const [serviceKey, entry] of Object.entries(this._services(consumer))) {
        const conf = MetaTables._map(entry);
        const bond = MetaTables.parseBond(conf.bond);
        if (bond === null) continue;
        const provider = this.providerOf(serviceKey);
        if (!provider || provider === consumer) continue;
        edges.set(`${consumer}|${provider}`, { bond, serviceKey, enabled: conf.enabled });
      }
    }
    return edges;
  }

  static bondParticipants(edges) {
    const seen = new Set();
    for (const pair of edges.keys()) {
      const [consumer, provider] = pair.split('|');
      seen.add(consumer);
      seen.add(provider);
    }
    return [...seen].sort();
  }

  static _memBytes(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Math.trunc(value);
    const text = String(value).trim();
    if (!text) return null;
    const match = text.match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/);
    if (!match) return null;
    const unit = match[2].toLowerCase().replace(/b$/, '');
    const scale = {
      '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12,
      ki: 1024, mi: 1024 ** 2, gi: 1024 ** 3, ti: 1024 ** 4,
    }[unit];
    return scale === undefined ? null : Math.round(Number(match[1]) * scale);
  }

  static _cpus(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  static _int(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    const parsed = Number(String(value).trim());
    return Number.isInteger(parsed) ? parsed : null;
  }

  static _isEnabled(conf, defaultEnabled) {
    if (!('enabled' in conf)) return defaultEnabled;
    const raw = conf.enabled;
    if (typeof raw === 'boolean') return raw;
    return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
  }

  static _isShared(conf) {
    const raw = 'shared' in conf ? conf.shared : false;
    if (typeof raw === 'boolean') return raw;
    return ['true', '1', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  }

  static _looksLikeContainer(conf) {
    return MetaTables._RESOURCE_KEYS.concat(MetaTables._CONTAINER_KEYS).some(k => k in conf);
  }

  static _hasResourceKeys(conf) {
    return MetaTables._RESOURCE_KEYS.some(k => k in conf);
  }

  static _deepMerge(base, override) {
    if (
      base && typeof base === 'object' && !Array.isArray(base) &&
      override && typeof override === 'object' && !Array.isArray(override)
    ) {
      const merged = { ...base };
      for (const [key, value] of Object.entries(override)) {
        merged[key] = MetaTables._deepMerge(merged[key], value);
      }
      return merged;
    }
    return override;
  }

  static _row(roleName, serviceKey, conf, depth) {
    const bond = MetaTables.parseBond(conf.bond);
    return {
      depth,
      role: roleName,
      service: serviceKey,
      mem_reservation_bytes: MetaTables._memBytes(conf.mem_reservation),
      mem_limit_bytes: MetaTables._memBytes(conf.mem_limit),
      min_storage_bytes: MetaTables._memBytes(conf.min_storage),
      pids_limit_int: MetaTables._int(conf.pids_limit),
      cpus_float: MetaTables._cpus(conf.cpus),
      bond_float: bond === null ? 1.0 : bond,
    };
  }

  _collectResources(roleName, applications, visited, rows, depth, loaded) {
    if (visited.has(roleName)) return;
    visited.add(roleName);
    if (!(roleName in applications)) return;

    const services = MetaTables._map(applications[roleName].services);
    const entity = this.entityName(roleName);

    const add = (serviceKey, conf) => {
      if (loaded.has(serviceKey)) return;
      loaded.add(serviceKey);
      rows.push(MetaTables._row(roleName, serviceKey, conf, depth));
    };

    if (entity && entity in services) add(entity, MetaTables._map(services[entity]));

    const sharedDependencies = [];
    const nestedMaps = {};
    for (const [serviceKey, rawConf] of Object.entries(services)) {
      if (serviceKey === entity) continue;
      const conf = MetaTables._map(rawConf);
      if (Object.keys(conf).length === 0) continue;
      if (!MetaTables._isEnabled(conf, MetaTables._looksLikeContainer(conf))) continue;

      const providerRole = this.providerOf(serviceKey);
      if (MetaTables._hasResourceKeys(conf)) {
        add(serviceKey, conf);
      } else if (providerRole && providerRole !== roleName) {
        sharedDependencies.push(providerRole);
        if ('services' in conf) nestedMaps[providerRole] = conf.services;
      } else if (!MetaTables._isShared(conf) && MetaTables._looksLikeContainer(conf)) {
        add(serviceKey, conf);
      }
    }

    for (const providerRole of sharedDependencies) {
      let scoped = applications;
      if (providerRole in nestedMaps) {
        const demanded = nestedMaps[providerRole];
        const providerConf = { ...MetaTables._map(applications[providerRole]) };
        providerConf.services = demanded === null || demanded === undefined
          ? {}
          : MetaTables._deepMerge(providerConf.services, demanded);
        scoped = { ...applications, [providerRole]: providerConf };
      }
      this._collectResources(providerRole, scoped, visited, rows, depth + 1, loaded);
    }
  }

  static aggregate(rows) {
    const totals = {
      mem_reservation_bytes: 0, mem_limit_bytes: 0, min_storage_bytes: 0,
      pids_limit_int: 0, cpus_float: 0,
    };
    const present = {};
    for (const row of rows) {
      for (const column of ['mem_reservation_bytes', 'mem_limit_bytes', 'min_storage_bytes', 'pids_limit_int']) {
        if (row[column] !== null) {
          totals[column] += row[column];
          present[column] = true;
        }
      }
      if (row.cpus_float !== null) {
        totals.cpus_float = Math.max(totals.cpus_float, row.cpus_float);
        present.cpus_float = true;
      }
    }
    return Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, present[k] ? v : null])
    );
  }

  resourceRows() {
    return Object.keys(this.applications).sort().map(role => {
      const rows = [];
      this._collectResources(role, this.applications, new Set(), rows, 1, new Set());
      return { role, services: rows.length, ...MetaTables.aggregate(rows) };
    });
  }

  _directDepRoles(services) {
    const seen = new Set();
    const out = [];
    for (const [serviceKey, entry] of Object.entries(MetaTables._map(services))) {
      const conf = MetaTables._map(entry);
      if (Object.keys(conf).length === 0) continue;
      if (!(MetaTables._isExplicitTruth(conf.enabled) && MetaTables._isExplicitTruth(conf.shared))) {
        continue;
      }
      const provider = this.providerOf(serviceKey);
      if (provider && !seen.has(provider)) {
        seen.add(provider);
        out.push(provider);
      }
    }
    return out;
  }

  _graphs() {
    const forward = {};
    const reverse = {};
    for (const consumer of this.roles) {
      const providers = this._directDepRoles(this._services(consumer));
      forward[consumer] = providers;
      for (const provider of providers) {
        (reverse[provider] = reverse[provider] || []).push(consumer);
      }
    }
    return { forward, reverse };
  }

  static _resolveTransitively(start, graph, maxLevel) {
    const seen = new Set([start]);
    const order = [];
    const queue = (graph[start] || []).map(role => [role, 1]);
    while (queue.length) {
      const [role, depth] = queue.shift();
      if (seen.has(role)) continue;
      seen.add(role);
      order.push(role);
      if (maxLevel !== null && depth >= maxLevel) continue;
      for (const next of graph[role] || []) {
        if (!seen.has(next)) queue.push([next, depth + 1]);
      }
    }
    return order;
  }

  _lifecycle(role) {
    for (const entry of Object.values(this._services(role))) {
      const conf = MetaTables._map(entry);
      if (conf.lifecycle) return String(conf.lifecycle);
    }
    return '';
  }

  complexityRows() {
    const { forward, reverse } = this._graphs();
    const rows = Object.keys(this.applications).sort().map(name => {
      const services = MetaTables._resolveTransitively(name, forward, null);
      const consumers = MetaTables._resolveTransitively(name, reverse, null);
      const servicesDirect = MetaTables._resolveTransitively(name, forward, 1);
      const consumersDirect = MetaTables._resolveTransitively(name, reverse, 1);
      return {
        name,
        lifecycle: this._lifecycle(name),
        embeds: services.length,
        consumers: consumers.length,
        embeds_direct: servicesDirect.length,
        consumers_direct: consumersDirect.length,
        weight: services.length + consumers.length + servicesDirect.length + consumersDirect.length,
        integrated: servicesDirect.length > 0,
        dna: [...new Set([name, ...services])].sort().join('\n'),
      };
    });

    const byDna = new Map();
    for (const row of rows) {
      if (!byDna.has(row.dna)) byDna.set(row.dna, []);
      byDna.get(row.dna).push(row);
    }
    for (const group of byDna.values()) {
      const original = group.reduce(
        (best, row) => (row.weight > best.weight || (row.weight === best.weight && row.name > best.name) ? row : best)
      );
      for (const row of group) {
        row.siblings = group.filter(other => other !== row).map(other => other.name).sort();
        row.clone = row.name !== original.name;
      }
    }
    return rows;
  }
}

MetaTables._RESOURCE_KEYS = ['mem_reservation', 'mem_limit', 'pids_limit', 'cpus'];
MetaTables._CONTAINER_KEYS = ['image', 'name', 'version', 'container'];

window.MetaTables = MetaTables;
