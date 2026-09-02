// dataLoader.js
//
// Scans the mounted infinito roles tree directly: the role list comes from
// nginx's JSON autoindex of /roles/, and per-role metadata is the parsed
// meta/*.yml itself. No pre-generated helper files.
class DataLoader {
  constructor(basePath = '/roles') {
    this.basePath = basePath;
    this._metaCache = new Map();
  }

  listRoles() {
    return fetch(`${this.basePath}/`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to list roles: ${res.status}`);
        return res.json();
      })
      .then(entries => entries
        .filter(e => e.type === 'directory')
        .map(e => e.name)
        .sort());
  }

  _fetchYaml(url) {
    return fetch(url).then(res => {
      if (!res.ok) return null;
      return res.text().then(text => {
        try {
          return jsyaml.load(text);
        } catch (err) {
          console.warn(`Unparseable YAML at ${url}`, err);
          return null;
        }
      });
    });
  }

  loadCategories() {
    return this._fetchYaml('/meta/categories.yml').then(data => {
      if (!data?.roles) {
        throw new Error(
          '/meta/categories.yml is missing or has no roles mapping. Mount the '
          + 'infinito repository meta/ directory (INFINITO_META_DIR in .env) '
          + 'and recreate the stack with make up.'
        );
      }
      return data.roles;
    });
  }

  // The graph needs meta/main.yml (galaxy_info) and meta/services.yml
  // (provides / run_after / modes / flags), the tables additionally
  // vars/main.yml (application_id). Fetch exactly those three by their fixed
  // names, so one role costs three requests instead of an autoindex plus one
  // per meta file (~1400 -> ~800 total).
  loadMeta(role) {
    if (this._metaCache.has(role)) {
      return Promise.resolve(this._metaCache.get(role));
    }
    const metaDir = `${this.basePath}/${role}/meta`;
    const promise = Promise.all([
      this._fetchYaml(`${metaDir}/main.yml`),
      this._fetchYaml(`${metaDir}/services.yml`),
      this._fetchYaml(`${this.basePath}/${role}/vars/main.yml`),
    ])
      .then(([main, services, vars]) => {
        const meta = {};
        if (main) meta.main = main;
        if (services) meta.services = services;
        if (vars) meta.vars = vars;
        return meta;
      })
      .catch(() => ({}));
    this._metaCache.set(role, promise);
    return promise;
  }

  loadSideFile(role, name) {
    const key = `${name}:${role}`;
    if (this._metaCache.has(key)) {
      return Promise.resolve(this._metaCache.get(key));
    }
    const promise = this._fetchYaml(`${this.basePath}/${role}/meta/${name}.yml`);
    this._metaCache.set(key, promise);
    return promise;
  }

  loadSideFileAll(roles, name, limit = 12) {
    return this._pool(roles, role => this.loadSideFile(role, name).then(data => [role, data]), limit)
      .then(pairs => Object.fromEntries(pairs.filter(([, data]) => data)));
  }

  loadBrandIndex() {
    return fetch('vendor/simple-icons/index.json')
      .then(res => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }

  _pool(items, task, limit) {
    const results = [];
    let index = 0;
    const worker = () => {
      if (index >= items.length) return Promise.resolve();
      const current = index++;
      return task(items[current]).then(value => {
        results[current] = value;
        return worker();
      });
    };
    return Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, worker)
    ).then(() => results);
  }

  // Bounded concurrency: fire at most `limit` role loads at once so the
  // browser's per-host connection cap does not turn boot into a stall.
  loadAll(roles, onProgress, limit = 12) {
    const result = {};
    let index = 0;
    let done = 0;
    const worker = () => {
      if (index >= roles.length) return Promise.resolve();
      const role = roles[index++];
      return this.loadMeta(role).then(meta => {
        result[role] = meta;
        done += 1;
        if (onProgress) onProgress(done, roles.length);
        return worker();
      });
    };
    return Promise.all(
      Array.from({ length: Math.min(limit, roles.length) }, worker)
    ).then(() => result);
  }
}

window.DataLoader = DataLoader;
