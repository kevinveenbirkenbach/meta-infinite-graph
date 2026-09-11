// The reusable deploy workflow uploads, but its artifacts land on the entry
// run that called it, so these are the runs worth listing.
const DEPLOYING = /\/entry-(push-latest|pr-change-orchestrate|manual-steer)\.yml$/;
const NAME = /^playwright-([a-z]+)-(.+)$/;
const TAIL = /^(?:-([\d,]+))?(-tor)?(?:-([a-z]+))?(?:-([a-z0-9]+))?$/;

export class TestRuns {
  // Args:
  //   api: GitHubApi, for the runs and their artifact lists.
  //   root: () => the owner/name whose runs are listed.
  constructor(api, root) {
    this.api = api;
    this.root = root;
    this.runs = null;
    this.run = null;
    this.repo = null;
    this.artifacts = [];
    this.unpacked = new Map();
    this.onLoad = null;
  }

  // Returns: { done, total } over the picked run's artifacts.
  progress() {
    const states = this.artifacts.map(artifact => (this.unpacked.get(artifact.id) || {}).state);
    return { done: states.filter(state => state && state !== 'loading').length, total: states.length };
  }

  // Returns: the picked run as the URL carries it, its id alone for the root
  //   repository and <owner/name>@<id> for a fork.
  key() {
    return this.run ? this.keyOf(this.run, this.repo) : '';
  }

  // Args:
  //   run: a workflow run as GitHub lists it.
  //   repo: its owner/name, when the run does not carry it.
  keyOf(run, repo = run.repository ? run.repository.full_name : this.root()) {
    return repo === this.root() ? String(run.id) : `${repo}@${run.id}`;
  }

  // Args:
  //   name: an artifact name, playwright-<mode>-<role>[-<variants>][-tor][-<distro>][-<filesystem>].
  //   roles: every role name, because a role name holds dashes of its own.
  // Returns: { mode, role, variants, tor, distro, filesystem }, or null.
  static parse(name, roles) {
    const match = NAME.exec(name);
    if (!match) return null;
    const role = roles
      .filter(one => match[2] === one || match[2].startsWith(`${one}-`))
      .sort((one, other) => other.length - one.length)[0];
    const tail = role && TAIL.exec(match[2].slice(role.length));
    if (!tail) return null;
    return {
      mode: match[1],
      role,
      variants: tail[1] ? tail[1].split(',').map(Number) : [],
      tor: Boolean(tail[2]),
      distro: tail[3] || '',
      filesystem: tail[4] || '',
    };
  }

  async list() {
    if (!this.runs) {
      const body = await this.api.get(`/repos/${this.root()}/actions/runs?per_page=50`, false);
      this.runs = (body.workflow_runs || []).filter(run => DEPLOYING.test(run.path || ''));
    }
    return this.runs;
  }

  // Args:
  //   key: what key() returns, or '' for none.
  //   roles: every role name, for parse().
  //   known: the run itself when the caller already holds it.
  async pick(key, roles, known = null) {
    this.run = null;
    this.artifacts = [];
    if (!key) return;
    const [repo, id] = String(key).includes('@') ? String(key).split('@') : [this.root(), String(key)];
    if (!known) await this.list().catch(() => null);
    const listed = [];
    for (let page = 1; ; page += 1) {
      const body = await this.api.get(
        `/repos/${repo}/actions/runs/${id}/artifacts?per_page=100&page=${page}`, false
      );
      listed.push(...(body.artifacts || []));
      if (!(body.artifacts || []).length || listed.length >= (body.total_count || 0)) break;
    }
    this.repo = repo;
    this.run = known || (this.runs || []).find(run => String(run.id) === id) || { id: Number(id), run_number: id };
    this.artifacts = listed
      .map(artifact => ({ ...TestRuns.parse(artifact.name, roles), id: artifact.id, name: artifact.name }))
      .filter(artifact => artifact.role);
  }

  // Returns: the artifacts of one test line; a variant-blind line takes all of its role's.
  of(role, variant) {
    return this.artifacts.filter(artifact => artifact.role === role
      && (variant === null || !artifact.variants.length || artifact.variants.includes(variant)));
  }

  // Returns: a promise for /git/artifact's answer, asked once per artifact;
  //   state(id) follows it.
  load(id) {
    if (!this.unpacked.has(id)) {
      const query = new URLSearchParams({ id: String(id), repo: this.repo || this.root() });
      const entry = { state: 'loading', answer: null, error: null, promise: null };
      entry.promise = fetch(`/git/artifact?${query}`).then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        Object.assign(entry, { state: 'done', answer: body });
        return body;
      }).catch(error => {
        Object.assign(entry, { state: 'error', error });
        throw error;
      });
      this.unpacked.set(id, entry);
      const artifact = this.artifacts.find(one => one.id === id);
      if (this.onLoad) this.onLoad(artifact ? artifact.name : String(id), entry.promise);
    }
    return this.unpacked.get(id).promise;
  }

  retry() {
    for (const [id, entry] of this.unpacked) if (entry.state === 'error') this.unpacked.delete(id);
  }

  // Args:
  //   onEach: called whenever one more artifact of the picked run is in.
  // Returns: a promise settled once every one of them was asked for, a few
  //   at a time so the server downloads in parallel without a stampede.
  prefetch(onEach, width = 3) {
    const queue = this.artifacts.map(artifact => artifact.id).filter(id => !this.unpacked.has(id));
    const worker = async () => {
      while (queue.length) {
        await this.load(queue.shift()).catch(() => null);
        onEach();
      }
    };
    return Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker));
  }

  // Args:
  //   row: a test row of a line this run carried.
  // Returns: 'loading' while an artifact of its line is on its way, 'error'
  //   when one failed, else the worst result the test had in any report of
  //   its line, or 'missing' when none lists it.
  outcome(row) {
    let worst = 'missing';
    const rank = { missing: 0, skipped: 1, passed: 2, failed: 3 };
    for (const artifact of this.of(row.role, row.variant)) {
      const entry = this.unpacked.get(artifact.id);
      if (!entry || entry.state === 'loading') return 'loading';
      if (entry.state === 'error') return 'error';
      for (const report of entry.answer.reports) {
        if (report.app !== row.role || (row.variant !== null && report.variant !== row.variant)) continue;
        const test = report.tests.find(one => one.name === row.test || one.name.endsWith(` › ${row.test}`));
        if (test && rank[test.status] > rank[worst]) worst = test.status;
      }
    }
    return worst;
  }
}
