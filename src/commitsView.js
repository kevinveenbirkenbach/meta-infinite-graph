// Reads no roles tree, so this view stays usable at a date where the ones
// derived from it are greyed out.
class CommitsView {
  // Args:
  //   range: the GitRange holding the window and the ticked refs.
  //   container: the element the table is rendered into.
  constructor(range, container) {
    this.range = range;
    this.container = container;
    this.walked = new Map();
  }

  invalidate() {
    this.walked.clear();
  }

  static _text(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  _repoOf() {
    const owner = new Map();
    for (const repo of (this.range.catalog || { repos: [] }).repos) {
      for (const ref of repo.refs) owner.set(ref.ref, repo.full_name);
    }
    return owner;
  }

  show() {
    this.container.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'table-section';
    section.appendChild(CommitsView._text('h2', 'Commits'));
    this.note = CommitsView._text('p', 'Reading the mirror …', 'table-note');
    section.appendChild(this.note);
    this.host = document.createElement('div');
    this.host.className = 'commits-host';
    section.appendChild(this.host);
    this.container.appendChild(section);

    if (!this.range.catalog) {
      this.note.textContent = 'No local mirror, so there is nothing to read commits from.';
      return Promise.resolve();
    }
    const owner = this._repoOf();
    const refs = this.range.refs.filter(ref => owner.has(ref));
    if (!refs.length) {
      this.note.textContent = 'No source ticked. Pick a branch in the sources menu below.';
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

    this.note.textContent = `${listed.length} commits across ${refs.length} `
      + `${refs.length === 1 ? 'ref' : 'refs'}`
      + (rows.length === listed.length
        ? '.'
        : `, merged from ${rows.length} rows because the refs share history.`);

    const table = document.createElement('table');
    table.className = 'table table-sm commits-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const title of ['Date', 'Repository', 'Ref', 'Commit', 'Subject']) {
      headRow.appendChild(CommitsView._text('th', title));
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    for (const row of listed) {
      const line = document.createElement('tr');
      line.appendChild(CommitsView._text('td', row.date.slice(0, 10), 'commits-date'));
      line.appendChild(CommitsView._text('td', row.repo));
      line.appendChild(CommitsView._text('td', row.ref, 'commits-ref'));
      const sha = CommitsView._text('td', row.sha.slice(0, 8), 'commits-sha');
      sha.title = row.sha;
      line.appendChild(sha);
      const subject = CommitsView._text('td', row.message, 'commits-subject');
      if ((row.parents || []).length > 1) subject.classList.add('merge');
      line.appendChild(subject);
      body.appendChild(line);
    }
    table.appendChild(body);
    this.host.innerHTML = '';
    this.host.appendChild(table);
    return listed;
  }
}

window.CommitsView = CommitsView;
