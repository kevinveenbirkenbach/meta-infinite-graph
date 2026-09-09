class ForkTree {
  constructor(api, container, cards) {
    this.api = api;
    this.container = container;
    this.cards = cards;
    this.root = 'infinito-nexus/core';
    this.loaded = null;
    this.branches = true;
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

  static TOKEN_HELP = '#github-token';

  static _rich(tag, parts, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    for (const part of parts) {
      element.appendChild(
        typeof part === 'string'
          ? document.createTextNode(part)
          : ForkTree._text('code', part.code)
      );
    }
    return element;
  }

  static _steps(items) {
    const list = document.createElement('ol');
    for (const parts of items) list.appendChild(ForkTree._rich('li', parts));
    return list;
  }

  static tokenHelp() {
    const card = document.createElement('div');
    card.className = 'role-card token-help';
    card.appendChild(ForkTree._text('div', '🔑 GitHub token', 'role-card-title'));
    card.appendChild(ForkTree._text(
      'p',
      'GitHub answers 60 requests an hour to an address that sends no token. A '
      + 'full fork tree costs around 32, so the second visit runs dry. A token '
      + 'lifts the ceiling to 5000 an hour.',
      'role-card-desc'
    ));

    card.appendChild(ForkTree._text('h4', 'Create one'));
    card.appendChild(ForkTree._steps([
      ['Open Settings, Developer settings, Personal access tokens, Fine-grained tokens, then Generate new token.'],
      ['Resource owner: your own account. Expiration: any date, the tree needs nothing long lived.'],
      ['Repository access: ', { code: 'Public repositories (read-only)' }, '.'],
      ['Leave every permission untouched. Public repository metadata needs none of them.'],
      ['Generate, then copy the ', { code: 'github_pat_…' }, ' value. GitHub shows it exactly once.'],
    ]));
    card.appendChild(ForkTree._text(
      'p',
      'A classic token works as well: create one with no scope ticked at all. An '
      + 'empty scope still reads public data at the authenticated rate.',
      'token-help-aside'
    ));

    card.appendChild(ForkTree._text('h4', 'Paste it into the field'));
    card.appendChild(ForkTree._rich('p', [
      'It stays in this browser under the key ', { code: 'mig-gh-token' },
      ' and travels only to ', { code: 'api.github.com' },
      '. It is never written into the address bar, so a link you share carries '
      + 'the view and not the credential. The button below the field erases it '
      + 'again together with the cache.',
    ], 'token-help-aside'));

    card.appendChild(ForkTree._text('h4', 'Or persist it in .env'));
    card.appendChild(ForkTree._rich('p', [
      'Put the token into the ', { code: '.env' },
      ' file of the server that hosts this page, beside ', { code: 'MIG_PORT' }, ':',
    ], 'token-help-aside'));
    card.appendChild(ForkTree._text('pre', 'MIG_GITHUB_TOKEN=github_pat_…'));
    card.appendChild(ForkTree._rich('p', [
      'and start it with ', { code: 'make up' },
      '. The container then writes an nginx snippet that attaches the ',
      { code: 'Authorization' }, ' header to a ', { code: '/gh/' },
      ' proxy, so the browser calls its own origin and never receives the token. '
      + 'This field disappears and every visitor shares the one budget of 5000 an hour.',
    ], 'token-help-aside'));

    const links = document.createElement('div');
    links.className = 'role-card-links';
    for (const [text, href] of [
      ['Create a token', 'https://github.com/settings/personal-access-tokens/new'],
      ['Rate limits', 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api'],
    ]) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = text;
      links.appendChild(link);
    }
    card.appendChild(links);
    return card;
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
    this.plot = document.createElement('div');
    this.plot.className = 'fork-plot-host';
    section.appendChild(this.plot);
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
        this.network = [
          { ...repo, parent: null },
          ...forks.map(fork => ({ ...fork, parent: repo.full_name })),
        ];
        this.histories = {};
        this._plot();
        this._describe(repo, forks);
        return this._allHistories();
      })
      .catch(error => this._fail(error));
  }

  // Fork points come free with the fork list, so this draws before any history.
  _plot() {
    if (!this.network) return;
    const graph = new ForkGraph(this.network, this.histories);
    const drawn = ForkPlot.draw(graph, this.plot.clientWidth || 900, (commit, repo, event) => {
      if (!commit) return this.cards.release(ForkTree.COMMIT);
      this._point = { x: event.clientX, y: event.clientY };
      this.cards.show(ForkTree.COMMIT, this._point, () => ForkTree.commitCard(commit, repo));
    });
    this.plot.innerHTML = '';
    if (!drawn) return;
    this.plot.appendChild(drawn.svg);
    const span = graph.span();
    if (this.refused) {
      this.plot.appendChild(ForkTree._text('p', ForkTree._refusal(this.refused), 'fork-error'));
    }
    this.plot.appendChild(ForkTree._text(
      'p',
      span.zoomed
        ? `Axis: ${ForkTree._date(new Date(span.from).toISOString())} to `
          + `${ForkTree._date(new Date(span.to).toISOString())}, the window of the loaded `
          + 'commits. Fork lines older than it are clamped to the left edge.'
        : `Axis: ${ForkTree._date(new Date(span.from).toISOString())} to `
          + `${ForkTree._date(new Date(span.to).toISOString())}. Open a repository to draw its `
          + 'commit lanes and merges; the axis then narrows to that history.',
      'fork-axis-note'
    ));
  }

  static COMMIT = '#fork-commit';

  // The plot silently losing its lanes reads as "this repository has no
  // branches", so a refusal has to say which one it was and what it costs.
  static _refusal(error) {
    if (error.status === 404) {
      return `No branch lines: ${error.message}. A 404 here is either a branch that does `
        + 'not exist or a path the server proxy does not carry; the fork network above is '
        + 'complete either way.';
    }
    return error.exhausted
      ? 'GitHub is out of requests for this hour, so no branch lines could be drawn. '
        + 'The fork network above is complete. Add a token in the filter panel, or turn '
        + 'the branch lines off in the design panel to spend the budget on the network alone.'
      : `GitHub answered ${error.status || 'with an error'} for the commit histories, `
        + 'so no branch lines could be drawn. The fork network above is complete.';
  }

  static commitCard(commit, repo) {
    const card = document.createElement('div');
    card.className = 'role-card commit-card';
    card.appendChild(ForkTree._text('div', `${commit.sha.slice(0, 8)} in ${repo.id}`, 'role-card-title'));
    card.appendChild(ForkTree._text('p', commit.message, 'role-card-desc'));
    const facts = document.createElement('dl');
    facts.className = 'role-card-facts';
    facts.append(ForkTree._text('dt', 'Date'), ForkTree._text('dd', ForkTree._date(commit.date)));
    facts.append(
      ForkTree._text('dt', 'Parents'),
      ForkTree._text('dd', (commit.parents || []).map(sha => sha.slice(0, 8)).join(', ') || 'root')
    );
    card.appendChild(facts);
    return card;
  }

  _describe(repo, forks) {
    const deeper = forks.filter(fork => fork.forks_count > 0).length;
    const parts = [
      `${forks.length} direct fork${forks.length === 1 ? '' : 's'} of ${repo.full_name}`,
      deeper
        ? `${deeper} of them are forked again; open one to walk deeper`
        : 'none of them are forked again, so this is the whole network',
      'Branches, tags and the commit lanes load when a repository is opened.',
    ];
    this.note.textContent = `${parts.join('. ')} ${this._quota()}`;
  }

  // Three cases, not two: in proxied mode api.token is deliberately empty
  // because the server holds it, so reading that alone would report the
  // authenticated 5000 ceiling as "unauthenticated".
  _quota() {
    const rate = this.api.rate;
    if (!rate || !rate.limit) return '';
    const scope = this.api.proxied ? "through the server's token"
      : this.api.token ? 'with your token' : 'unauthenticated';
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
    this._history(repo);
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

  // Args:
  //   next: whether the plot should carry branch lines.
  // Returns: a promise for the redraw, so a caller can wait for the fetches.
  setBranches(next) {
    this.branches = next;
    if (!this.network) return Promise.resolve();
    if (!next) {
      this.refused = null;
      this.histories = {};
      this._plot();
      return Promise.resolve();
    }
    return this._allHistories();
  }

  // Serial, and stopped at the first refusal: each repository costs one
  // request, so a network of thirty forks would otherwise empty an
  // unauthenticated hour in one burst before the first line is drawn.
  _allHistories() {
    if (!this.branches || !this.network) return Promise.resolve();
    this.refused = null;
    return this.network.reduce(
      (chain, repo) => chain.then(() => (this.refused ? null : this._history(repo))),
      Promise.resolve()
    ).then(() => this._plot());
  }

  // One call per repository, not per branch; see GitHubApi.commits.
  _history(repo) {
    if (!this.branches || !this.histories || repo.full_name in this.histories) {
      return Promise.resolve();
    }
    this.histories[repo.full_name] = [];
    return this.api.commits(repo.full_name, repo.default_branch)
      .then(commits => {
        this.histories[repo.full_name] = commits.map(entry => ({
          sha: entry.sha,
          parents: (entry.parents || []).map(parent => parent.sha),
          date: entry.commit.committer.date,
          message: entry.commit.message.split('\n')[0],
        }));
        this._plot();
      })
      .catch(error => {
        delete this.histories[repo.full_name];
        this.refused = error;
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
