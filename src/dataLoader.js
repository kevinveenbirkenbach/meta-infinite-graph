// dataLoader.js
//
// Scans the mounted infinito roles tree directly: the role list comes from
// nginx's JSON autoindex of /roles/, and per-role metadata is the parsed
// meta/*.yml itself. No pre-generated helper files.
class DataLoader {
  constructor(basePath = '/roles', metaPath = '/meta') {
    this.basePath = basePath;
    this.metaPath = metaPath;
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

  listDir(path) {
    return fetch(`${this.basePath}/${path}/`)
      .then(res => (res.ok ? res.json() : []))
      .then(entries => (Array.isArray(entries) ? entries : []))
      .catch(() => []);
  }

  loadText(path) {
    return fetch(`${this.basePath}/${path}`)
      .then(res => (res.ok ? res.text() : null))
      .catch(() => null);
  }

  // Args:
  //   role: the role whose Playwright suite to read.
  // Returns: { entries, files, env } where files is the closure of every
  //   *.spec.js / *.test.js in the role and the local requires they pull in.
  //   A require that misses is a shared harness module the deploy copies in,
  //   not a role file, so it is skipped rather than treated as an error.
  loadPlaywright(role) {
    const dir = `${role}/files/playwright`;
    return this.listDir(dir).then(listing => {
      const names = listing
        .filter(entry => entry.type === 'file' && /\.js$/.test(entry.name))
        .map(entry => entry.name.replace(/\.js$/, ''));
      const entries = names.filter(name => /\.(spec|test)$/.test(name));
      if (!entries.length) return null;
      const files = {};
      const walk = pending => {
        const missing = pending.filter(name => !(name in files) && names.includes(name));
        if (!missing.length) return Promise.resolve();
        for (const name of missing) files[name] = null;
        return Promise.all(missing.map(name => this.loadText(`${dir}/${name}.js`)
          .then(text => {
            files[name] = text || '';
            return PlaywrightMatrix.localRequires(files[name]);
          })))
          .then(nested => walk(nested.flat()));
      };
      return walk(entries)
        .then(() => this.loadText(`${role}/templates/playwright.env.j2`))
        .then(env => ({ entries, files, env: env || '' }));
    });
  }

  // The CI ranking is declared in the core checkout's default.env, mounted
  // beside the roles tree. Absent, the view falls back to name order.
  loadSettings() {
    return fetch('/infinito.env')
      .then(res => (res.ok ? res.text() : ''))
      .catch(() => '');
  }

  // Presence of a templates/*compose*.yml.j2 is the signal, not an image key,
  // so a stack built from source still counts.
  loadStack(role) {
    const hunt = (path, depth) => this.listDir(path).then(entries => {
      if (entries.some(e => e.type === 'file' && /compose.*\.yml\.j2$/.test(e.name))) return true;
      if (depth === 0) return false;
      const dirs = entries.filter(e => e.type === 'directory');
      return Promise.all(dirs.map(dir => hunt(`${path}/${dir.name}`, depth - 1)))
        .then(found => found.some(Boolean));
    });
    return hunt(`${role}/templates`, 2);
  }

  loadStackAll(roles, limit = 12) {
    return this._pool(roles, role => this.loadStack(role).then(stack => [role, stack]), limit)
      .then(Object.fromEntries);
  }

  loadPlaywrightAll(roles, limit = 8) {
    return this._pool(roles, role => this.loadPlaywright(role).then(suite => [role, suite]), limit)
      .then(pairs => Object.fromEntries(pairs.filter(([, suite]) => suite)));
  }

  // Args:
  //   role: the role whose CLI test to read.
  // Returns: null when the role ships no files/test/test.sh, else the timeout
  //   from meta/tests.yml, the *_ENABLED keys templates/test.env.j2 declares
  //   and the shared harnesses the script sources. There is no service-gate
  //   contract here, so those env keys are the closest thing to a switch.
  loadCli(role) {
    return this.loadText(`${role}/files/test/test.sh`).then(script => {
      if (!script) return null;
      return Promise.all([
        this.loadText(`${role}/templates/test.env.j2`),
        this._fetchYaml(`${this.basePath}/${role}/meta/tests.yml`),
      ]).then(([env, meta]) => ({
        flags: [...(env || '').matchAll(/^([A-Z][A-Z0-9_]*_ENABLED)\s*=/gm)]
          .map(match => match[1]).sort(),
        shared: [...new Set(
          [...script.matchAll(/shared\/([A-Za-z0-9_-]+)/g)].map(match => match[1])
        )].sort(),
        timeout: meta && meta.cli ? meta.cli.timeout : null,
      }));
    });
  }

  loadCliAll(roles, limit = 8) {
    return this._pool(roles, role => this.loadCli(role).then(suite => [role, suite]), limit)
      .then(pairs => Object.fromEntries(pairs.filter(([, suite]) => suite)));
  }

  // The persona flows carry the gates most specs inherit without naming a
  // service themselves, so the matrix is wrong without them.
  loadHarness() {
    const dir = 'test-e2e-playwright/files/personas';
    const flows = { runAdminFlow: 'admin', runBiberFlow: 'biber', runGuestFlow: 'guest' };
    return Promise.all(Object.entries(flows).map(([name, file]) => this
      .loadText(`${dir}/${file}.js`)
      .then(text => [name, text || ''])))
      .then(Object.fromEntries);
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
    return this._fetchYaml(`${this.metaPath}/categories.yml`).then(data => {
      if (!data?.roles) {
        throw new Error(
          `${this.metaPath}/categories.yml is missing or has no roles mapping. Mount the `
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
