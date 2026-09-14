// GitHub keeps what a job reported with ::warning:: and ::error:: on the check
// run behind the job, one request per job, and a deploy run has over a
// hundred jobs.
const PAGE = 100;
const RANK = { failure: 0, warning: 1, notice: 2 };
// Requests left in the hour below which the remaining jobs stay unread, so a
// run with a hundred of them cannot spend the budget of every other view.
const RESERVE = 20;

export function severity(level) {
  return level in RANK ? level : 'notice';
}

export class RunAnnotations {
  // Args:
  //   api: the GitHubApi; every answer it caches makes a second look free.
  constructor(api) {
    this.api = api;
    this.runs = new Map();
    this.width = 3;
  }

  static key(repo, run) {
    return `${repo}@${run.id}`;
  }

  // Returns: what is known about a run so far: its jobs, the annotations read
  //   until now, how many jobs are done, and the first error if one failed.
  state(repo, run) {
    return this.runs.get(RunAnnotations.key(repo, run)) || null;
  }

  // Returns: every annotation read so far, worst first.
  entries() {
    return [...this.runs.values()]
      .flatMap(state => state.entries)
      .sort((one, other) => RANK[one.level] - RANK[other.level]
        || one.repo.localeCompare(other.repo)
        || one.job.localeCompare(other.job));
  }

  // Returns: { done, total } over every run being read.
  progress() {
    const states = [...this.runs.values()];
    return {
      done: states.reduce((sum, state) => sum + state.done, 0),
      total: states.reduce((sum, state) => sum + state.jobs.length, 0),
    };
  }

  forget() {
    this.runs.clear();
  }

  // Args:
  //   repo: owner/name the run belongs to.
  //   run: the workflow run as GitHub lists it.
  //   onEach: called whenever one more job's annotations are in.
  // Returns: a promise settled once every job of the run was read; the jobs
  //   that are not green come first, the green ones follow on their own.
  load(repo, run, onEach = () => {}) {
    const key = RunAnnotations.key(repo, run);
    if (!this.runs.has(key)) {
      const state = { repo, run, jobs: [], entries: [], done: 0, failed: null, stopped: false };
      this.runs.set(key, state);
      state.promise = this._read(state, onEach);
    }
    return this.runs.get(key).promise;
  }

  async _read(state, onEach) {
    try {
      state.jobs = await this._jobs(state.repo, state.run.id);
    } catch (error) {
      state.failed = error;
      onEach();
      return;
    }
    const queue = [
      ...state.jobs.filter(job => job.conclusion !== 'success'),
      ...state.jobs.filter(job => job.conclusion === 'success'),
    ];
    const worker = async () => {
      while (queue.length) {
        if (this._spent()) {
          state.stopped = true;
          return;
        }
        const job = queue.shift();
        state.entries.push(...await this._annotations(state, job));
        state.done += 1;
        onEach();
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.width, queue.length) }, worker));
  }

  _spent() {
    const rate = this.api.rate;
    return Boolean(rate && rate.limit && rate.remaining <= RESERVE);
  }

  async _jobs(repo, id) {
    const jobs = [];
    for (let page = 1; ; page += 1) {
      const body = await this.api.get(`/repos/${repo}/actions/runs/${id}/jobs?per_page=${PAGE}&page=${page}`, false);
      const listed = (body && body.jobs) || [];
      jobs.push(...listed);
      if (!listed.length || jobs.length >= ((body && body.total_count) || 0)) break;
    }
    return jobs;
  }

  async _annotations(state, job) {
    const check = String(job.check_run_url || '').split('/check-runs/')[1];
    if (!check) return [];
    try {
      const listed = await this.api.get(`/repos/${state.repo}/check-runs/${check}/annotations?per_page=${PAGE}`, false);
      return (Array.isArray(listed) ? listed : []).map(entry => ({
        repo: state.repo,
        run: state.run,
        job: job.name,
        jobUrl: job.html_url,
        level: severity(entry.annotation_level),
        path: entry.path === '.github' ? '' : entry.path || '',
        line: entry.start_line || 0,
        title: entry.title || '',
        message: (entry.message || '').trim(),
      }));
    } catch (error) {
      state.failed = state.failed || error;
      return [];
    }
  }
}
