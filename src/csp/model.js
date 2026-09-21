// What a role's meta/csp.yml opens up, read from the repository rather than
// from a running deployment.
const RANK = { 'unsafe-eval': 0, 'unsafe-inline': 1, wildcard: 2, scheme: 3, host: 4 };
// A role may turn on any token its directive understands, so the class of an
// exception is named by the file, not by a list this app keeps.
const CLASSES = ['wildcard', 'scheme', 'host'];
const SCHEMES = ['data:', 'blob:', 'filesystem:', 'mediastream:'];

export class CspScan {
  // Args:
  //   loader: the DataLoader reading roles/<role>/meta/csp.yml.
  constructor(loader) {
    this.loader = loader;
    this.found = null;
  }

  static kindOf(source) {
    if (source === '*' || source.startsWith('*.')) return 'wildcard';
    if (SCHEMES.includes(source)) return 'scheme';
    return 'host';
  }

  static rank(entry) {
    return RANK[entry.kind] ?? 5;
  }

  // Returns: whether a kind is one this app classified rather than a token a
  //   role wrote, which decides between a translated word and the token itself.
  static classified(kind) {
    return CLASSES.includes(kind);
  }

  // Args:
  //   text: the file as written, for the reason each nocheck marker carries;
  //     the parsed YAML has dropped those comments.
  // Returns: directive -> flag -> reason, '' where the line states none.
  static reasons(text) {
    const found = {};
    let directive = '';
    for (const line of (text || '').split('\n')) {
      const header = /^\s{2}([\w-]+):\s*$/.exec(line);
      if (header) {
        directive = header[1];
        found[directive] = found[directive] || {};
        continue;
      }
      const flag = /^\s{4}([\w-]+):\s*true\s*(?:#\s*(.*))?$/.exec(line);
      if (flag && directive) {
        const note = (flag[2] || '').replace(/^nocheck:\s*\S+\s*/, '').replace(/^Reason:\s*/, '');
        found[directive][flag[1]] = note.trim();
      }
    }
    return found;
  }

  // Returns: one entry per exception a role declares, worst first.
  static entriesOf(role, parsed, text) {
    const reasons = CspScan.reasons(text);
    const found = [];
    for (const [directive, flags] of Object.entries((parsed && parsed.flags) || {})) {
      for (const [flag, on] of Object.entries(flags || {})) {
        if (!on) continue;
        found.push({
          role, directive, kind: flag, source: '', reason: (reasons[directive] || {})[flag] || '',
        });
      }
    }
    for (const [directive, sources] of Object.entries((parsed && parsed.whitelist) || {})) {
      for (const source of sources || []) {
        found.push({ role, directive, kind: CspScan.kindOf(String(source)), source: String(source), reason: '' });
      }
    }
    return found;
  }

  // Args:
  //   roles: every role name to read.
  //   onEach: called whenever one more role is in, for the progress label.
  // Returns: every exception of every role, worst first.
  async read(roles, onEach = () => {}) {
    const found = [];
    const read = async role => {
      const [parsed, text] = await Promise.all([
        this.loader.loadSideFile(role, 'csp'),
        this.loader.loadText(`${role}/meta/csp.yml`),
      ]);
      onEach();
      if (parsed) found.push(...CspScan.entriesOf(role, parsed, text));
    };
    await this.loader._pool(roles, read, 12);
    this.found = found.sort((one, other) => CspScan.rank(one) - CspScan.rank(other)
      || one.role.localeCompare(other.role)
      || one.directive.localeCompare(other.directive));
    return this.found;
  }
}
