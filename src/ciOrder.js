import { MetaTables } from './meta/tables.js';

export class CiOrder {
  // Args:
  //   settings: the parsed infinito.env, for the sort spec, the lifecycle
  //     envelope, the whitelist and the chunk slots.
  constructor(settings = {}) {
    this.settings = settings;
  }

  static MODES = ['compose', 'swarm', 'host'];

  // The last key of INFINITO_DISCOVERY_SORT is a nonce that core draws per
  // invocation unless INFINITO_DISCOVERY_SEED is set, so no reader can
  // reproduce it. Dropping it leaves the name fallback, which is stable.
  static UNREPRODUCIBLE = 'random';

  static parse(text) {
    const settings = {};
    for (const line of (text || '').split('\n')) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      settings[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
    }
    return settings;
  }

  // Args:
  //   spec: "asc clone,desc embeds" style, as INFINITO_DISCOVERY_SORT holds it.
  // Returns: [{ column, reverse }] in significance order, most significant first.
  static parseSort(spec) {
    const clauses = [];
    for (const clause of (spec || '').split(',')) {
      let column = null;
      let reverse = false;
      for (const token of clause.trim().split(/\s+/).filter(Boolean)) {
        const low = token.toLowerCase();
        if (low === 'asc' || low === 'desc') reverse = low === 'desc';
        else column = token;
      }
      if (column) clauses.push({ column, reverse });
    }
    return clauses;
  }

  static _value(row, column) {
    const value = row[column];
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (column === 'variant') return row.variant === null ? -1 : row.variant;
    return value === undefined ? 0 : value;
  }

  // Mirrors _apply_sort in cli/meta/roles/applications/complexity/cli.py: a
  // stable sort per clause from least to most significant, over a name base.
  static sort(rows, clauses) {
    const ordered = [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const { column, reverse } of [...clauses].reverse()) {
      if (column === CiOrder.UNREPRODUCIBLE) continue;
      ordered.sort((a, b) => {
        const left = CiOrder._value(a, column);
        const right = CiOrder._value(b, column);
        if (left === right) return 0;
        return (left < right ? -1 : 1) * (reverse ? -1 : 1);
      });
    }
    return ordered;
  }

  // Mirrors _mark_covered in complexity/cli.py. Only a variant-0 or whole-role
  // row is coverable: a coverer brings a provider up at variant 0, so it cannot
  // stand in for another variant's shape.
  static cover(rows) {
    const green = [];
    return rows.map((row, index) => {
      const id = index + 1;
      const coverable = row.variant === null || row.variant === 0;
      const coverer = coverable
        ? green.find(
          candidate => candidate.name !== row.name && candidate.services.has(row.name)
        )
        : null;
      if (!coverer) {
        green.push({ id, name: row.name, services: new Set(row.services || []) });
      }
      return { ...row, id, covered_by: coverer ? coverer.id : 0 };
    });
  }

  // Args:
  //   role: { name, lifecycle, stack, modes, testSkips }. `modes` is the
  //     primary entity's modes block from meta/services.yml, `testSkips` the
  //     skip list from meta/tests.yml. The two are different opt-outs and the
  //     discovery reads them at different stages: modes says where a role
  //     RUNS and gates discovery itself, skip only deactivates TESTING it.
  // Returns: the three test_<mode> columns CI discovery filters on.
  columns(role, invokablePaths) {
    const envelope = (this.settings.INFINITO_LIFECYCLES || '').split(/\s+/).filter(Boolean);
    const discovered = MetaTables.isInvokable(role.name, invokablePaths)
      && Boolean(role.lifecycle)
      && (!envelope.length || envelope.includes(role.lifecycle));
    const runs = mode => discovered && CiOrder.modeEnabled(role.modes, mode);
    const tested = mode => !(role.testSkips || []).includes(mode);
    const host = runs('host') && !role.stack && CiOrder.modeEnabled(role.modes, 'host');
    return {
      test_compose: runs('compose') && tested('compose'),
      test_swarm: runs('swarm') && Boolean(role.stack) && tested('swarm'),
      test_host: host && tested('host'),
    };
  }

  // A missing modes block, a missing mode or a missing enabled key all mean
  // the role takes part, so only an explicit false opts out.
  static modeEnabled(modes, mode) {
    const entry = modes && modes[mode];
    return !(entry && entry.enabled === false);
  }

  modes() {
    const raw = (this.settings.INFINITO_CI_MODES || '').trim();
    if (!raw || raw === 'auto') return CiOrder.MODES;
    return CiOrder.MODES.filter(mode => raw.split(/\s+/).includes(mode));
  }

  // Mirrors build_filter in cli/meta/ci/query.py.
  keeps(row) {
    const modes = this.modes();
    if (!modes.some(mode => row[`test_${mode}`])) return false;
    const names = key => (this.settings[key] || '').split(/\s+/).filter(Boolean);
    const include = names('INFINITO_WHITELIST');
    if (include.length && !include.includes(row.name)) return false;
    return !names('INFINITO_BLACKLIST').includes(row.name);
  }

  // Returns: the ordered rows, each carrying its 1-based id and covered_by.
  //   Chunk boundaries are deliberately absent: sizing them needs the job
  //   timeouts in .github/workflows, which is outside the mounted tree.
  rank(rows) {
    const clauses = CiOrder.parseSort(this.settings.INFINITO_DISCOVERY_SORT);
    const kept = rows.filter(row => this.keeps(row));
    const covered = CiOrder.cover(CiOrder.sort(kept, clauses));
    return CiOrder.sort(covered, clauses).map((row, index) => ({ ...row, rank: index + 1 }));
  }

}
