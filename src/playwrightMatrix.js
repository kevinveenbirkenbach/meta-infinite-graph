export class PlaywrightMatrix {
  // Args:
  //   harness: helper name -> { skip, branch }, from parseHarness(). Specs
  //     reach most of their gates through these shared persona flows.
  constructor(harness = {}) {
    this.harness = harness;
  }

  static SKIP_CALLS = ['skipUnlessServiceEnabled', 'safeSkipUnlessEnabled', 'requireService'];

  static BRANCH_CALLS = ['isServiceEnabled', 'safeIsEnabled', 'isServiceDisabledReason'];

  // Mirrors envKey() in roles/test-e2e-playwright/files/service-gating.js.
  static envKey(name) {
    return `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_SERVICE_ENABLED`;
  }

  static _strip(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  static _calls(body, names) {
    const found = new Set();
    for (const name of names) {
      const call = new RegExp(`\\b${name}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
      let match = call.exec(body);
      while (match) {
        found.add(match[1]);
        match = call.exec(body);
      }
    }
    return found;
  }

  // Returns: flag key -> the applications config path it reads, or null when
  //   the value comes from a role variable this parser cannot follow.
  static parseEnv(text) {
    const flags = {};
    for (const line of PlaywrightMatrix._strip(text || '').split('\n')) {
      const flag = line.match(/^\s*([A-Z][A-Z0-9_]*_SERVICE_ENABLED)\s*=(.*)$/);
      if (!flag) continue;
      const lookup = flag[2].match(/lookup\(\s*'config'\s*,\s*application_id\s*,\s*'([^']+)'/);
      flags[flag[1]] = lookup ? lookup[1] : null;
    }
    return flags;
  }

  // Args:
  //   files: helper name -> the source of the file that exports it.
  static parseHarness(files) {
    const harness = {};
    for (const [name, text] of Object.entries(files || {})) {
      const body = PlaywrightMatrix._strip(text || '');
      harness[name] = {
        skip: [...PlaywrightMatrix._calls(body, PlaywrightMatrix.SKIP_CALLS)].sort(),
        branch: [...PlaywrightMatrix._calls(body, PlaywrightMatrix.BRANCH_CALLS)].sort(),
      };
    }
    return harness;
  }

  gatesOf(body) {
    const skip = PlaywrightMatrix._calls(body, PlaywrightMatrix.SKIP_CALLS);
    const branch = PlaywrightMatrix._calls(body, PlaywrightMatrix.BRANCH_CALLS);
    for (const [name, gates] of Object.entries(this.harness)) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(body)) continue;
      for (const service of gates.skip) skip.add(service);
      for (const service of gates.branch) branch.add(service);
    }
    return { skip: [...skip].sort(), branch: [...branch].sort() };
  }

  // Most specs are a manifest of `require("./test-…")` siblings rather than a
  // file of tests, so the suite is the closure over those local requires.
  static localRequires(text) {
    const names = new Set();
    const body = PlaywrightMatrix._strip(text || '');
    const local = /require\(\s*['"]\.\/([A-Za-z0-9_.-]+)['"]\s*\)/g;
    let match = local.exec(body);
    while (match) {
      names.add(match[1].replace(/\.js$/, ''));
      match = local.exec(body);
    }
    return [...names];
  }

  // Splits at every `test(` that opens a line. Indentation is allowed because
  // a role may register its tests from inside an exports.register wrapper.
  // `test.use(`, `test.describe(` and friends carry a dot and never match.
  parseSpec(text) {
    const tests = [];
    for (const part of PlaywrightMatrix._strip(text || '').split(/^(?=[ \t]*test\s*\()/m)) {
      const title = part.match(/^[ \t]*test\s*\(\s*(['"`])([\s\S]*?)\1/);
      if (!title) continue;
      tests.push({ name: title[2], ...this.gatesOf(part) });
    }
    return tests;
  }

  // Args:
  //   files: module name -> source, already closed over the local requires.
  parseSuite(files) {
    const tests = [];
    for (const [module, text] of Object.entries(files || {})) {
      for (const test of this.parseSpec(text)) tests.push({ ...test, module });
    }
    return tests;
  }

  // Returns: true, false, or null when only the deployed closure settles it.
  //   MetaTables._isExplicitTruth() collapses that null to true because the
  //   bond CLI it mirrors counts a group_names flag as on.
  static truth(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
  }

  static _at(payload, path) {
    let node = payload;
    for (const step of path.split('.')) {
      if (!node || typeof node !== 'object') return undefined;
      node = node[step];
    }
    return node;
  }

  // Args:
  //   payload: the variant's meta topics, e.g. { services: …, mcp: … }.
  //   flags: parseEnv() output for the role.
  // Returns: { state, why } with state true, false or null.
  state(service, payload, flags) {
    const key = PlaywrightMatrix.envKey(service);
    if (!(key in flags)) return { state: false, why: `${key} is not declared` };
    const path = flags[key];
    if (!path) return { state: null, why: `${key} reads a role variable` };
    const value = PlaywrightMatrix._at(payload, path);
    if (value === undefined) {
      return { state: null, why: `${path} is not in the role's meta files` };
    }
    const state = PlaywrightMatrix.truth(value);
    return { state, why: state === null ? `${path} settles on the deployed closure` : path };
  }

  // Args:
  //   role, variant: the row's coordinates; variant is null for a role
  //     without meta/variants.yml.
  //   payload: the variant's merged meta topics.
  //   flags, tests: parseEnv() and parseSpec() output for the role.
  rows(role, variant, payload, flags, tests) {
    return tests.map(test => {
      const reasons = [];
      let status = 'runs';
      for (const service of test.skip) {
        const { state, why } = this.state(service, payload, flags);
        if (state === true) continue;
        reasons.push(`${service}: ${why}`);
        if (state === false) status = 'skipped';
        else if (status !== 'skipped') status = 'unknown';
      }
      return { role, variant, test: test.name, status, reasons, ...test };
    });
  }
}
