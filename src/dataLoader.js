import { PlaywrightMatrix } from './playwrightMatrix.js';
import { RoleFiles } from './role/files.js';

export class DataLoader extends RoleFiles {
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
}
