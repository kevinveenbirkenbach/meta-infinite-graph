// Port of, and kept in sync with, cli.meta.roles.applications.ressources.
class MetaResources extends MetaRegistry {
  static _RESOURCE_KEYS = ['mem_reservation', 'mem_limit', 'pids_limit', 'cpus'];

  static _CONTAINER_KEYS = ['image', 'name', 'version', 'container'];

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
    return MetaResources._RESOURCE_KEYS.concat(MetaResources._CONTAINER_KEYS).some(k => k in conf);
  }

  static _hasResourceKeys(conf) {
    return MetaResources._RESOURCE_KEYS.some(k => k in conf);
  }

  static _row(roleName, serviceKey, conf, depth) {
    const bond = MetaRegistry.parseBond(conf.bond);
    return {
      depth,
      role: roleName,
      service: serviceKey,
      mem_reservation_bytes: MetaResources._memBytes(conf.mem_reservation),
      mem_limit_bytes: MetaResources._memBytes(conf.mem_limit),
      min_storage_bytes: MetaResources._memBytes(conf.min_storage),
      pids_limit_int: MetaResources._int(conf.pids_limit),
      cpus_float: MetaResources._cpus(conf.cpus),
      bond_float: bond === null ? 1.0 : bond,
    };
  }

  _collectResources(roleName, applications, visited, rows, depth, loaded) {
    if (visited.has(roleName)) return;
    visited.add(roleName);
    if (!(roleName in applications)) return;

    const services = MetaRegistry._map(applications[roleName].services);
    const entity = this.entityName(roleName);

    const add = (serviceKey, conf) => {
      if (loaded.has(serviceKey)) return;
      loaded.add(serviceKey);
      rows.push(MetaResources._row(roleName, serviceKey, conf, depth));
    };

    if (entity && entity in services) add(entity, MetaRegistry._map(services[entity]));

    const sharedDependencies = [];
    const nestedMaps = {};
    for (const [serviceKey, rawConf] of Object.entries(services)) {
      if (serviceKey === entity) continue;
      const conf = MetaRegistry._map(rawConf);
      if (Object.keys(conf).length === 0) continue;
      if (!MetaResources._isEnabled(conf, MetaResources._looksLikeContainer(conf))) continue;

      const providerRole = this.providerOf(serviceKey);
      if (MetaResources._hasResourceKeys(conf)) {
        add(serviceKey, conf);
      } else if (providerRole && providerRole !== roleName) {
        sharedDependencies.push(providerRole);
        if ('services' in conf) nestedMaps[providerRole] = conf.services;
      } else if (!MetaResources._isShared(conf) && MetaResources._looksLikeContainer(conf)) {
        add(serviceKey, conf);
      }
    }

    for (const providerRole of sharedDependencies) {
      let scoped = applications;
      if (providerRole in nestedMaps) {
        const demanded = nestedMaps[providerRole];
        const providerConf = { ...MetaRegistry._map(applications[providerRole]) };
        providerConf.services = demanded === null || demanded === undefined
          ? {}
          : MetaRegistry._deepMerge(providerConf.services, demanded);
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

  // Returns: { totals, rows } for the role's base config, one row per service,
  //   shared dependencies resolved recursively at depth 2 and deeper.
  resourcesOf(role) {
    const rows = [];
    this._collectResources(role, this.applications, new Set(), rows, 1, new Set());
    return { totals: MetaResources.aggregate(rows), rows };
  }
}

window.MetaResources = MetaResources;
