// The suites `make test` fans out over, each a directory of the repository's
// tests tree. e2e is left out: Playwright and CLI have views of their own.
const KINDS = ['unit', 'integration', 'external', 'lint', 'performance', 'regression'];

const SHAPES = [
  { language: 'python', match: /^test_.+\.py$/, cases: /^[ \t]*(?:async +)?def +(test_\w+)/gm },
  { language: 'javascript', match: /\.test\.js$/, cases: /\b(?:test|it)\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g },
  { language: 'php', match: /Test\.php$/, cases: /function +(test\w+)\s*\(/g },
  { language: 'ruby', match: /_test\.rb$/, cases: /def +(test_\w+)/g },
];

const SKIP = new Set(['__pycache__', 'node_modules', '.pytest_cache', '.git']);

export class CodeTests {
  // Args:
  //   base: where the repository's tests tree is served, the worktree's copy
  //     of it once the time window sits in the past.
  constructor(base = '/infinito_tests') {
    this.base = base;
    this.trees = new Map();
    this.cases = new Map();
    this.parsed = new Map();
  }

  static get KINDS() {
    return KINDS;
  }

  // Returns: the language conventions of a test file, or null for a file no
  //   runner picks up (a helper, an __init__.py, a fixture).
  static shape(name) {
    return SHAPES.find(one => one.match.test(name)) || null;
  }

  forget() {
    this.trees.clear();
    this.cases.clear();
    this.parsed.clear();
  }

  _listDir(path) {
    return fetch(`${this.base}/${path}/`)
      .then(answer => (answer.ok ? answer.json() : null))
      .then(entries => (Array.isArray(entries) ? entries : null));
  }

  // Args:
  //   kind: one of KINDS.
  // Returns: [{ path, dir, name, language }] for every test file of that
  //   suite, or null when the tests tree is not served at all.
  list(kind) {
    if (!this.trees.has(kind)) this.trees.set(kind, this._walk(kind, kind, 6));
    return this.trees.get(kind);
  }

  async _walk(kind, path, depth) {
    const entries = await this._listDir(path);
    if (!entries) return path === kind ? null : [];
    const files = entries
      .filter(entry => entry.type === 'file' && CodeTests.shape(entry.name))
      .map(entry => ({
        path: `${path}/${entry.name}`,
        dir: path === kind ? '' : path.slice(kind.length + 1),
        name: entry.name,
        language: CodeTests.shape(entry.name).language,
      }));
    if (depth === 0) return files;
    const deeper = await Promise.all(entries
      .filter(entry => entry.type === 'directory' && !SKIP.has(entry.name))
      .map(entry => this._walk(kind, `${path}/${entry.name}`, depth - 1)));
    return [...files, ...deeper.flat()].sort((one, other) => one.path.localeCompare(other.path));
  }

  // Returns: the case names one file declares, read once and then remembered.
  //   A file that cannot be read counts as none, so one unreadable file never
  //   holds up the overview.
  load(file) {
    if (!this.cases.has(file.path)) {
      this.cases.set(file.path, fetch(`${this.base}/${file.path}`)
        .then(answer => (answer.ok ? answer.text() : ''))
        .catch(() => '')
        .then(text => {
          const cases = CodeTests.parse(text, file.name);
          this.parsed.set(file.path, cases);
          return cases;
        }));
    }
    return this.cases.get(file.path);
  }

  // Returns: what load() already holds for a file, or null while it is on its
  //   way, so a row can draw before every file was read.
  known(file) {
    return this.parsed.get(file.path) || null;
  }

  static parse(text, name) {
    const shape = CodeTests.shape(name);
    if (!shape || !text) return [];
    const found = [...text.matchAll(shape.cases)].map(match => match.slice(1).find(Boolean) || '');
    return [...new Set(found.filter(Boolean))];
  }

  // Args:
  //   files: what list() answered.
  //   onEach: called whenever one more file was read.
  // Returns: a promise settled once every file was read, a few at a time so
  //   the browser's connection cap does not turn the overview into a stall.
  read(files, onEach, width = 8) {
    const queue = files.filter(file => !this.cases.has(file.path));
    const worker = async () => {
      while (queue.length) {
        await this.load(queue.shift());
        onEach();
      }
    };
    return Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker));
  }

  // Returns: { done, total } over the files of one suite.
  progress(files) {
    return { done: files.filter(file => this.known(file)).length, total: files.length };
  }
}
