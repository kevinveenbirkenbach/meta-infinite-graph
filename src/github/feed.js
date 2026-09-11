import { el } from '../dom.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { FeedTable } from './table.js';
import { clock, elapsed, runSpan } from './time.js';

// The menu ticks refs, but a feed is per repository.
export function selectedRepos(range) {
  const wanted = new Set();
  for (const repo of (range.catalog || { repos: [] }).repos) {
    if (repo.refs.some(ref => range.refs.includes(ref.ref))) wanted.add(repo.full_name);
  }
  return [...wanted];
}

// Neither lives in a git mirror, so these are the only views still spending
// GitHub requests. GitHubApi caches every answer, so a second visit is free.
export class GitHubFeed {
  static KINDS = {
    pulls: {
      title: t('feed.pulls.title'),
      path: full => `/repos/${full}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      when: entry => entry.updated_at || entry.created_at,
      columns: ['updated', 'repository', 'state', 'number', 'subject'].map(column => t(`feed.pulls.${column}`)),
      cells: entry => [
        (entry.updated_at || '').slice(0, 10),
        entry.base && entry.base.repo ? entry.base.repo.full_name : '',
        entry.merged_at ? 'merged' : entry.state,
        `#${entry.number}`,
        entry.title,
      ],
      mark: entry => (entry.merged_at ? 'merged' : entry.state),
      markAt: 2,
      link: entry => entry.html_url,
      linkAt: 3,
    },
    actions: {
      title: t('feed.actions.title'),
      path: full => `/repos/${full}/actions/runs?per_page=100`,
      list: body => (body && body.workflow_runs) || [],
      when: entry => entry.created_at,
      columns: ['started', 'ended', 'duration', 'repository', 'result', 'run', 'workflow']
        .map(column => t(`feed.actions.${column}`)),
      cells: entry => {
        const span = runSpan(entry);
        return [
          clock(entry.run_started_at || entry.created_at),
          entry.status === 'completed' ? clock(entry.updated_at) : t('feed.actions.running'),
          span === null ? '' : elapsed(span),
          entry.repository ? entry.repository.full_name : '',
          entry.conclusion || entry.status,
          `#${entry.run_number}`,
          entry.name,
        ];
      },
      // Returns: the note's line on the longest run shown, or '' for none.
      longest: entries => {
        const [run, span] = entries.map(entry => [entry, runSpan(entry)])
          .reduce((most, next) => (next[1] !== null && (most[1] === null || next[1] > most[1]) ? next : most), [null, null]);
        return run ? t('feed.actions.longest', { duration: elapsed(span), run: `#${run.run_number}` }) : '';
      },
      mark: entry => entry.conclusion || entry.status,
      markAt: 4,
      link: entry => entry.html_url,
      linkAt: 5,
      repo: entry => (entry.repository ? entry.repository.full_name : ''),
      // Args:
      //   runs: one repository's runs from the answers so far.
      // Returns: the created_at a query for what changed starts at: the oldest
      //   run still going, since only those can still change, else the newest.
      since: runs => {
        const open = runs.filter(run => run.status !== 'completed').map(run => run.created_at).sort();
        if (open.length) return open[0];
        return runs.map(run => run.created_at).sort().pop() || null;
      },
      pickable: true,
      facets: [
        { name: 'result', label: t('feed.actions.result'), of: entry => entry.conclusion || entry.status },
        { name: 'event', label: t('feed.filter.event'), of: entry => entry.event },
        { name: 'workflow', label: t('feed.actions.workflow'), of: entry => entry.name },
        { name: 'branch', label: t('feed.filter.branch'), of: entry => entry.head_branch },
        { name: 'repository', label: t('feed.actions.repository'), of: entry => (entry.repository || {}).full_name },
      ],
      searched: entry => [entry.display_title, entry.name, entry.head_branch, entry.event, `#${entry.run_number}`],
    },
  };

  // Args:
  //   kind: a key of GitHubFeed.KINDS.
  //   api: the GitHubApi, whose cache is what keeps this cheap.
  //   range: the GitRange holding the window and the ticked refs.
  constructor(kind, api, range, container) {
    this.kind = kind;
    this.api = api;
    this.range = range;
    this.container = container;
    this.root = el('div', { className: 'table-section' });
    this.onPick = null;
    this.onFilter = null;
    this.known = null;
    this.repos = [];
    this.filters = Object.fromEntries(['search', ...(GitHubFeed.KINDS[kind].facets || []).map(facet => facet.name)]
      .map(name => [name, '']));
  }

  // Args:
  //   name: 'search', a facet name, or null to clear every filter.
  //   value: what the rows have to match, '' for anything.
  setFilter(name, value) {
    for (const key of Object.keys(this.filters)) {
      if (name === null || key === name) this.filters[key] = name === null ? '' : value || '';
    }
    if (this.known) this._render(this.repos, GitHubFeed.KINDS[this.kind]);
    if (this.onFilter) this.onFilter();
  }

  _matches(spec, entry) {
    const search = this.filters.search.trim().toLowerCase();
    if (search && !spec.searched(entry).some(value => String(value || '').toLowerCase().includes(search))) {
      return false;
    }
    return spec.facets.every(facet => !this.filters[facet.name] || facet.of(entry) === this.filters[facet.name]);
  }

  static _options(spec, entries) {
    return Object.fromEntries(spec.facets.map(facet => {
      const counts = new Map();
      for (const entry of entries) {
        const value = facet.of(entry);
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [facet.name, [...counts].sort((one, other) => other[1] - one[1] || String(one[0]).localeCompare(other[0]))];
    }));
  }

  _key(entry) {
    return GitHubFeed.KINDS[this.kind].link(entry) || JSON.stringify(entry);
  }

  _ask(repos, path, fresh, store) {
    const spec = GitHubFeed.KINDS[this.kind];
    return Promise.all(repos.map(full => this.api.get(path(full), false, fresh, store(full))
      .then(body => (spec.list ? spec.list(body) : body) || [])
      .catch(error => {
        this.failed = error;
        return [];
      })));
  }

  // Returns: the rows once every ticked repository was asked only for what
  //   changed since the last answer. A feed that cannot tell, has no answer
  //   yet, or whose repositories changed is asked for everything instead.
  update() {
    const spec = GitHubFeed.KINDS[this.kind];
    const repos = selectedRepos(this.range);
    if (!spec.since || !this.known || repos.join() !== this.repos.join()) return this.show(true);
    this.failed = null;
    const entries = [...this.known.values()];
    const since = Object.fromEntries(repos.map(full => [
      full, spec.since(entries.filter(entry => spec.repo(entry) === full)),
    ]));
    const path = full => (since[full]
      ? `${spec.path(full)}&created=${encodeURIComponent(`>=${since[full]}`)}`
      : spec.path(full));
    return this._ask(repos, path, true, full => !since[full]).then(answers => {
      for (const entry of answers.flat()) this.known.set(this._key(entry), entry);
      return this._render(repos, spec);
    });
  }

  _paint(spec, note, entries, options = {}) {
    render(html`<${FeedTable} spec=${spec} note=${note} entries=${entries} options=${options}
      filters=${this.filters} onFilter=${(name, value) => this.setFilter(name, value)}
      onPick=${spec.pickable && this.onPick} />`, this.root);
  }

  // Args:
  //   fresh: true asks GitHub again rather than the cache, and keeps the
  //     table on screen until the answer is in.
  show(fresh = false) {
    const spec = GitHubFeed.KINDS[this.kind];
    if (!fresh) {
      this.container.replaceChildren(this.root);
      this._paint(spec, t('feed.asking'), null);
    }
    this.failed = null;

    const repos = selectedRepos(this.range);
    if (!repos.length) {
      this._paint(spec, t(this.range.catalog ? 'feed.noSource' : 'feed.noMirror'), null);
      return Promise.resolve([]);
    }
    const cached = !fresh && repos.some(full => this.api.cached(spec.path(full)));
    return this._ask(repos, spec.path, fresh, () => true).then(answers => {
      // A pull request that targets a fork is listed by both repositories, so
      // the same entry can arrive twice.
      this.known = new Map(answers.flat().map(entry => [this._key(entry), entry]));
      this.repos = repos;
      const rows = this._render(repos, spec);
      return cached && spec.since ? this.update() : rows;
    });
  }

  _render(repos, spec) {
    const entries = [...this.known.values()];
    const from = this.range.since() ? Date.parse(this.range.since()) : -Infinity;
    const until = this.range.latest() ? Infinity : Date.parse(this.range.head());
    const inside = entries.filter(entry => {
      const at = Date.parse(spec.when(entry) || '');
      return !Number.isNaN(at) && at >= from && at <= until;
    }).sort((one, other) => Date.parse(spec.when(other)) - Date.parse(spec.when(one)));
    const shown = spec.facets ? inside.filter(entry => this._matches(spec, entry)) : inside;

    const note = [
      t('feed.note', { inside: inside.length, total: entries.length, n: repos.length }),
      shown.length === inside.length ? '' : t('feed.filter.shown', { n: shown.length }),
      spec.longest ? spec.longest(shown) : '',
      this.failed ? t('feed.failed', { status: this.failed.status || t('feed.anError') }) : '',
    ].filter(Boolean).join(' ');
    this._paint(spec, note, shown, spec.facets ? GitHubFeed._options(spec, inside) : {});
    return shown;
  }
}
