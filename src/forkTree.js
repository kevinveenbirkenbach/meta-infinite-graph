class ForkTree {
  constructor(api, container) {
    this.api = api;
    this.container = container;
    this.root = 'infinito-nexus/core';
    this.loaded = null;
  }

  setRoot(fullName) {
    if (!ForkTree.isRepo(fullName) || fullName === this.root) return;
    this.root = fullName;
    this.invalidate();
  }

  invalidate() {
    this.loaded = null;
    this.section = null;
  }

  static isRepo(value) {
    return typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value);
  }

  static _text(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  static _date(iso) {
    return typeof iso === 'string' ? iso.slice(0, 10) : '';
  }

  show() {
    this.container.innerHTML = '';
    if (!this.section) {
      this.section = this._shell();
      this.loaded = this._load();
    }
    this.container.appendChild(this.section);
    return this.loaded;
  }

  _shell() {
    const section = document.createElement('div');
    section.className = 'table-section';
    section.appendChild(ForkTree._text('h2', 'Fork network'));
    this.note = ForkTree._text('p', `Reading ${this.root} …`, 'table-note');
    section.appendChild(this.note);
    this.list = document.createElement('ul');
    this.list.className = 'fork-tree';
    section.appendChild(this.list);
    return section;
  }

  _load() {
    return Promise.all([this.api.repo(this.root), this.api.forks(this.root)])
      .then(([repo, forks]) => {
        this.list.innerHTML = '';
        this.list.appendChild(this._node(repo, true));
        const children = document.createElement('ul');
        for (const fork of forks) children.appendChild(this._node(fork, false));
        if (forks.length) this.list.lastChild.appendChild(children);
        this._describe(repo, forks);
      })
      .catch(error => this._fail(error));
  }

  _describe(repo, forks) {
    const deeper = forks.filter(fork => fork.forks_count > 0).length;
    const parts = [
      `${forks.length} direct fork${forks.length === 1 ? '' : 's'} of ${repo.full_name}`,
      deeper
        ? `${deeper} of them are forked again; open one to walk deeper`
        : 'none of them are forked again, so this is the whole network',
      'Branches and tags load when a repository is opened.',
    ];
    this.note.textContent = `${parts.join('. ')} ${this._quota()}`;
  }

  _quota() {
    const rate = this.api.rate;
    if (!rate || !rate.limit) return '';
    const scope = this.api.token ? 'with your token' : 'unauthenticated';
    return `${rate.remaining} of ${rate.limit} requests left this hour, ${scope}.`;
  }

  _fail(error) {
    this.list.innerHTML = '';
    this.note.textContent = error.exhausted
      ? 'GitHub is out of requests for this hour. Add a token in the filter panel to raise the '
        + 'limit from 60 to 5000, or come back after the hour turns.'
      : `GitHub answered ${error.status || 'with an error'}: ${error.message}`;
  }

  _node(repo, isRoot) {
    const item = document.createElement('li');
    item.className = 'fork-node';

    const head = document.createElement('div');
    head.className = 'fork-head';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fork-toggle';
    toggle.textContent = '▸';
    head.appendChild(toggle);

    const link = document.createElement('a');
    link.href = repo.html_url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = repo.full_name;
    link.className = isRoot ? 'fork-name root' : 'fork-name';
    head.appendChild(link);

    head.appendChild(ForkTree._text('span', repo.default_branch || '', 'chip'));
    if (repo.forks_count) {
      head.appendChild(ForkTree._text('span', `⑂ ${repo.forks_count}`, 'chip'));
    }
    if (repo.stargazers_count) {
      head.appendChild(ForkTree._text('span', `★ ${repo.stargazers_count}`, 'chip'));
    }
    head.appendChild(ForkTree._text('span', ForkTree._date(repo.pushed_at), 'fork-date'));
    item.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fork-body';
    body.hidden = true;
    item.appendChild(body);

    let opened = false;
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '▸' : '▾';
      if (body.hidden || opened) return;
      opened = true;
      this._fill(body, repo);
    });
    return item;
  }

  _fill(body, repo) {
    body.textContent = 'Loading …';
    // Versions come from tags, not releases: this network carries 68 tags and
    // zero releases, so a /releases call per node would spend quota on nothing.
    const wanted = [
      ['Branches', this.api.branches(repo.full_name), b => b.name],
      ['Versions', this.api.tags(repo.full_name), t => t.name],
    ];
    Promise.all(wanted.map(([, promise]) => promise.catch(error => error)))
      .then(results => {
        body.textContent = '';
        results.forEach((result, index) => {
          const [title, , label] = wanted[index];
          if (result instanceof Error) {
            body.appendChild(ForkTree._text('div', `${title}: ${result.message}`, 'fork-error'));
            return;
          }
          const row = document.createElement('div');
          row.className = 'fork-refs';
          row.appendChild(ForkTree._text('span', `${title} (${result.length})`, 'fork-refs-title'));
          for (const entry of result) {
            row.appendChild(ForkTree._text('span', label(entry), 'chip'));
          }
          body.appendChild(row);
        });
        if (this.note) this.note.textContent = this.note.textContent.replace(/\d+ of \d+ requests.*$/, this._quota());
        if (repo.forks_count) this._deeper(body, repo);
      });
  }

  _deeper(body, repo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-primary mt-2';
    button.textContent = `Show the ${repo.forks_count} forks of ${repo.full_name}`;
    button.addEventListener('click', () => {
      button.disabled = true;
      this.api.forks(repo.full_name)
        .then(forks => {
          const children = document.createElement('ul');
          for (const fork of forks) children.appendChild(this._node(fork, false));
          button.replaceWith(children);
        })
        .catch(error => {
          button.disabled = false;
          body.appendChild(ForkTree._text('div', error.message, 'fork-error'));
        });
    });
    body.appendChild(button);
  }
}

window.ForkTree = ForkTree;
