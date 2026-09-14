import { el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { selectedBranches } from './feed.js';
import { WarningTable } from './warnTable.js';

export class GitHubWarnings {
  // Args:
  //   annotations: the RunAnnotations shared with the code test views, so a
  //     run read here is not read again there.
  constructor(api, range, container, annotations) {
    this.api = api;
    this.range = range;
    this.container = container;
    this.annotations = annotations;
    this.root = el('div', { className: 'table-section' });
    this.pinned = null;
    this.states = [];
    this.note = '';
    this.repaint = null;
    this.onFilter = null;
    /** @type {(promise: Promise<unknown>, label: () => string) => unknown} */
    this.track = promise => promise;
    this.filters = { search: '', level: '', job: '', repository: '' };
  }

  // Args:
  //   name: 'search', a facet name, or null to clear every filter.
  setFilter(name, value) {
    for (const key of Object.keys(this.filters)) {
      if (name === null || key === name) this.filters[key] = name === null ? '' : value || '';
    }
    this._paint();
    if (this.onFilter) this.onFilter();
  }

  // Args:
  //   repo: owner/name of the run picked elsewhere, '' for none.
  //   run: that run as GitHub lists it.
  pin(repo, run) {
    const held = this.pinned ? this.pinned.run.id : null;
    if ((run ? run.id : null) === held) return;
    this.pinned = run ? { repo, run } : null;
    this.invalidate();
  }

  invalidate() {
    this.states = [];
  }

  _soon() {
    if (this.repaint) return;
    this.repaint = setTimeout(() => {
      this.repaint = null;
      this._paint();
    }, 200);
  }

  _rows() {
    const search = this.filters.search.trim().toLowerCase();
    return this.annotations.entries()
      .filter(entry => this.states.some(state => state.repo === entry.repo && state.run.id === entry.run.id))
      .filter(entry => (!this.filters.level || entry.level === this.filters.level)
        && (!this.filters.job || entry.job === this.filters.job)
        && (!this.filters.repository || entry.repo === this.filters.repository)
        && (!search || [entry.title, entry.message, entry.path, entry.job]
          .some(value => String(value || '').toLowerCase().includes(search))));
  }

  static _options(entries) {
    const facets = { level: entry => entry.level, job: entry => entry.job, repository: entry => entry.repo };
    return Object.fromEntries(Object.entries(facets).map(([name, of]) => {
      const counts = new Map();
      for (const entry of entries) counts.set(of(entry), (counts.get(of(entry)) || 0) + 1);
      return [name, [...counts].sort((one, other) => other[1] - one[1] || String(one[0]).localeCompare(other[0]))];
    }));
  }

  _paint(note = null, entries = undefined) {
    const all = this.states.length ? this.annotations.entries()
      .filter(entry => this.states.some(state => state.repo === entry.repo && state.run.id === entry.run.id)) : [];
    const rows = entries === undefined ? this._rows() : entries;
    const runs = this.states.map(state => ({
      repo: state.repo, run: state.run, done: state.done, total: state.jobs.length, failed: state.failed,
    }));
    this.note = note === null ? this._note(all, rows) : note;
    render(html`<${WarningTable} note=${this.note} runs=${runs} entries=${rows}
      options=${GitHubWarnings._options(all)} filters=${this.filters}
      onFilter=${(name, value) => this.setFilter(name, value)} />`, this.root);
  }

  _note(all, rows) {
    const levels = ['failure', 'warning', 'notice']
      .map(level => [level, all.filter(entry => entry.level === level).length]);
    return [
      t('warnings.note', {
        n: this.states.length,
        failure: levels[0][1],
        warning: levels[1][1],
        notice: levels[2][1],
      }),
      rows.length === all.length ? '' : t('feed.filter.shown', { n: rows.length }),
    ].filter(Boolean).join(' ');
  }

  // Args:
  //   fresh: true asks GitHub again rather than the cache.
  // Returns: the annotations of the newest run of every ticked branch, plus
  //   the picked run, read job by job with the ones that are not green first.
  async show(fresh = false) {
    this.container.replaceChildren(this.root);
    if (fresh) this.annotations.forget();
    if (this.states.length) {
      this._paint();
      return this.annotations.entries();
    }
    this._paint(t('feed.asking'), null);
    const pairs = selectedBranches(this.range);
    if (!pairs.length) {
      this._paint(t(this.range.catalog ? 'feed.noSource' : 'feed.noMirror'), null);
      return [];
    }
    await this.api.detectProxy();
    const runs = await this._newest(pairs, fresh);
    if (!runs.length) {
      this._paint(t('warnings.noRun'), []);
      return [];
    }
    this.states = runs.map(({ repo, run }) => {
      this.annotations.load(repo, run, () => this._soon());
      return this.annotations.state(repo, run);
    });
    this._paint();
    return this.track(
      Promise.all(this.states.map(state => state.promise)).then(() => {
        this._paint();
        return this.annotations.entries();
      }),
      () => t('loader.task.warnings', this.annotations.progress())
    );
  }

  // Returns: one run per ticked branch, newest first, plus the picked one, at
  //   most once per run.
  async _newest(pairs, fresh) {
    const answers = await Promise.all(pairs.map(({ repo, branch }) => this.api
      .get(`/repos/${repo}/actions/runs?per_page=1&branch=${encodeURIComponent(branch)}`, false, fresh)
      .then(body => {
        const [run] = (body && body.workflow_runs) || [];
        return run ? { repo, run } : null;
      })
      .catch(() => null)));
    const found = [...(this.pinned ? [this.pinned] : []), ...answers.filter(Boolean)];
    const seen = new Set();
    return found.filter(({ repo, run }) => {
      const key = `${repo}@${run.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
