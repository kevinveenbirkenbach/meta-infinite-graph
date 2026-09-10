import { el } from '../dom.js';
import { html, render } from '../html.js';

// Neither lives in a git mirror, so these are the only views still spending
// GitHub requests. GitHubApi caches every answer, so a second visit is free.
export class GitHubFeed {
  static KINDS = {
    pulls: {
      title: 'Pull requests',
      path: full => `/repos/${full}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      when: entry => entry.updated_at || entry.created_at,
      columns: ['Updated', 'Repository', 'State', 'PR', 'Title'],
      cells: entry => [
        (entry.updated_at || '').slice(0, 10),
        entry.base && entry.base.repo ? entry.base.repo.full_name : '',
        entry.merged_at ? 'merged' : entry.state,
        `#${entry.number}`,
        entry.title,
      ],
      mark: entry => (entry.merged_at ? 'merged' : entry.state),
      link: entry => entry.html_url,
    },
    actions: {
      title: 'Workflow runs',
      path: full => `/repos/${full}/actions/runs?per_page=100`,
      list: body => (body && body.workflow_runs) || [],
      when: entry => entry.created_at,
      columns: ['Started', 'Repository', 'Result', 'Run', 'Workflow'],
      cells: entry => [
        (entry.created_at || '').slice(0, 10),
        entry.repository ? entry.repository.full_name : '',
        entry.conclusion || entry.status,
        `#${entry.run_number}`,
        entry.name,
      ],
      mark: entry => entry.conclusion || entry.status,
      link: entry => entry.html_url,
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
  }

  // The menu ticks refs, but a feed is per repository.
  _repos() {
    const wanted = new Set();
    for (const repo of (this.range.catalog || { repos: [] }).repos) {
      if (repo.refs.some(ref => this.range.refs.includes(ref.ref))) wanted.add(repo.full_name);
    }
    return [...wanted];
  }

  _paint(spec, note, entries) {
    render(html`<${Feed} spec=${spec} note=${note} entries=${entries} />`, this.root);
  }

  show() {
    const spec = GitHubFeed.KINDS[this.kind];
    this.container.replaceChildren(this.root);
    this._paint(spec, 'Asking GitHub …', null);

    const repos = this._repos();
    if (!repos.length) {
      this._paint(spec, this.range.catalog
        ? 'No source ticked. Pick a repository in the sources menu below.'
        : 'No local mirror, so there is no source list to read from.', null);
      return Promise.resolve([]);
    }
    return Promise.all(repos.map(full => this.api.get(spec.path(full), false)
      .then(body => (spec.list ? spec.list(body) : body) || [])
      .catch(error => {
        this.failed = error;
        return [];
      })))
      .then(answers => this._render(answers.flat(), repos, spec));
  }

  _render(entries, repos, spec) {
    // A pull request that targets a fork is listed by both repositories, so the
    // same entry can arrive twice.
    const once = new Map();
    for (const entry of entries) once.set(spec.link(entry) || JSON.stringify(entry), entry);
    entries = [...once.values()];
    const from = this.range.since() ? Date.parse(this.range.since()) : -Infinity;
    const until = Date.parse(this.range.head());
    const inside = entries.filter(entry => {
      const at = Date.parse(spec.when(entry) || '');
      return !Number.isNaN(at) && at >= from && at <= until;
    }).sort((one, other) => Date.parse(spec.when(other)) - Date.parse(spec.when(one)));

    this._paint(spec, `${inside.length} of ${entries.length} in this window, `
      + `across ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}.`
      + (this.failed ? ` GitHub answered ${this.failed.status || 'with an error'}.` : ''), inside);
    return inside;
  }
}

function Feed({ spec, note, entries }) {
  const cell = (entry, value, index) => {
    if (index === 2) return html`<td class=${`feed-mark feed-${spec.mark(entry)}`}>${value}</td>`;
    if (index === 3 && spec.link(entry)) {
      return html`<td><a href=${spec.link(entry)} target="_blank" rel="noreferrer">${value}</a></td>`;
    }
    return html`<td>${value}</td>`;
  };
  return html`
    <h2>${spec.title}</h2>
    <p class="table-note">${note}</p>
    <div>
      ${entries && html`
        <table class="table table-sm feed-table">
          <thead><tr>${spec.columns.map(title => html`<th>${title}</th>`)}</tr></thead>
          <tbody>
            ${entries.map(entry => html`<tr>${spec.cells(entry).map((value, index) => cell(entry, value, index))}</tr>`)}
          </tbody>
        </table>
      `}
    </div>
  `;
}
