import { el } from './dom.js';
import { html, render } from './html.js';

// Reads no roles tree, so this view stays usable at a date where the ones
// derived from it are greyed out.
export class CommitsView {
  // Args:
  //   range: the GitRange holding the window and the ticked refs.
  //   container: the element the table is rendered into.
  constructor(range, container) {
    this.range = range;
    this.container = container;
    this.walked = new Map();
    this.root = el('div', { className: 'table-section' });
  }

  invalidate() {
    this.walked.clear();
  }

  _repoOf() {
    const owner = new Map();
    for (const repo of (this.range.catalog || { repos: [] }).repos) {
      for (const ref of repo.refs) owner.set(ref.ref, repo.full_name);
    }
    return owner;
  }

  _paint(note, listed) {
    render(html`<${Commits} note=${note} listed=${listed} />`, this.root);
  }

  show() {
    this.container.replaceChildren(this.root);
    this._paint('Reading the mirror …', null);

    if (!this.range.catalog) {
      this._paint('No local mirror, so there is nothing to read commits from.', null);
      return Promise.resolve();
    }
    const owner = this._repoOf();
    const refs = this.range.refs.filter(ref => owner.has(ref));
    if (!refs.length) {
      this._paint('No source ticked. Pick a branch in the sources menu below.', null);
      return Promise.resolve();
    }
    // Keyed by the window too, so moving a handle is not answered from a walk
    // taken over a different range.
    const key = `${this.range.since()}|${this.range.head()}`;
    return Promise.all(refs.map(ref => {
      const cached = this.walked.get(`${key}|${ref}`);
      if (cached) return Promise.resolve(cached);
      return this.range.log(ref).then(rows => {
        const walk = rows.map(row => ({ ...row, ref, repo: owner.get(ref) }));
        this.walked.set(`${key}|${ref}`, walk);
        return walk;
      });
    })).then(walks => this._render(walks.flat(), refs));
  }

  _render(rows, refs) {
    const seen = new Map();
    for (const row of rows) if (!seen.has(row.sha)) seen.set(row.sha, row);
    const listed = [...seen.values()].sort((one, other) => other.date.localeCompare(one.date));

    this._paint(`${listed.length} commits across ${refs.length} `
      + `${refs.length === 1 ? 'ref' : 'refs'}`
      + (rows.length === listed.length
        ? '.'
        : `, merged from ${rows.length} rows because the refs share history.`), listed);
    return listed;
  }
}

function Commits({ note, listed }) {
  return html`
    <h2>Commits</h2>
    <p class="table-note">${note}</p>
    <div class="commits-host">
      ${listed && html`
        <table class="table table-sm commits-table">
          <thead><tr>${['Date', 'Repository', 'Ref', 'Commit', 'Subject'].map(title => html`<th>${title}</th>`)}</tr></thead>
          <tbody>
            ${listed.map(row => html`
              <tr>
                <td class="commits-date">${row.date.slice(0, 10)}</td>
                <td>${row.repo}</td>
                <td class="commits-ref">${row.ref}</td>
                <td class="commits-sha" title=${row.sha}>${row.sha.slice(0, 8)}</td>
                <td class=${(row.parents || []).length > 1 ? 'commits-subject merge' : 'commits-subject'}>${row.message}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `;
}
