import { el, textElement } from '../dom.js';
import { ForkCards } from './cards.js';
import { ForkGraph } from './graph.js';
import { ForkHistory } from './history.js';
import { ForkPlot } from './plot.js';

export class ForkTree extends ForkHistory {
  constructor(api, container, cards) {
    super(api);
    this.container = container;
    this.cards = cards;
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
    const section = el('div', { className: 'table-section' });
    section.appendChild(textElement('h2', 'Timeline'));
    this.note = textElement('p', `Reading ${this.root} …`, 'table-note');
    section.appendChild(this.note);
    this.plot = el('div', { className: 'fork-plot-host' });
    section.appendChild(this.plot);
    this.list = el('ul', { className: 'fork-tree' });
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
        this.tagsBy = {};
        this._plot();
        this._describe(repo, forks);
        return this._allHistories().then(() => this._allTags());
      })
      .catch(error => this._fail(error));
  }

  // Fork points come free with the fork list, so this draws before any history.
  _plot() {
    if (!this.network) return;
    const graph = new ForkGraph(this.network, this.histories, this.tagsBy);
    const drawn = ForkPlot.draw(graph, this.plot.clientWidth || 900, (commit, repo, event) => {
      if (!commit) return this.cards.release(ForkCards.COMMIT);
      this._point = { x: event.clientX, y: event.clientY };
      this.cards.show(ForkCards.COMMIT, this._point, () => ForkCards.commitCard(commit, repo));
    });
    this.plot.innerHTML = '';
    if (!drawn) return;
    this.plot.appendChild(drawn.svg);
    const rows = graph.rows();
    const placed = rows.reduce((sum, row) => sum + (row.tags || []).length, 0);
    const orphaned = rows.reduce((sum, row) => sum + (row.orphanedTags || 0), 0);
    if (placed || orphaned) {
      this.plot.appendChild(textElement('p', ForkCards.tagNote(placed, orphaned), 'fork-tag-note'));
    }
    if (this.refused) {
      this.plot.appendChild(textElement('p', ForkCards.refusal(this.refused), 'fork-error'));
    }
    this.plot.appendChild(textElement('p', ForkCards.axisNote(graph.span()), 'fork-axis-note'));
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
    const item = el('li', { className: 'fork-node' });
    const head = el('div', { className: 'fork-head' });
    const toggle = el('button', { type: 'button', className: 'fork-toggle', textContent: '▸' });
    head.appendChild(toggle);
    head.appendChild(el('a', {
      href: repo.html_url, target: '_blank', rel: 'noreferrer', textContent: repo.full_name,
      className: isRoot ? 'fork-name root' : 'fork-name',
    }));
    head.appendChild(textElement('span', repo.default_branch || '', 'chip'));
    if (repo.forks_count) {
      head.appendChild(textElement('span', `⑂ ${repo.forks_count}`, 'chip'));
    }
    if (repo.stargazers_count) {
      head.appendChild(textElement('span', `★ ${repo.stargazers_count}`, 'chip'));
    }
    head.appendChild(textElement('span', ForkCards.date(repo.pushed_at), 'fork-date'));
    item.appendChild(head);

    const body = el('div', { className: 'fork-body', hidden: true });
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
            body.appendChild(textElement('div', `${title}: ${result.message}`, 'fork-error'));
            return;
          }
          const row = el('div', { className: 'fork-refs' });
          row.appendChild(textElement('span', `${title} (${result.length})`, 'fork-refs-title'));
          for (const entry of result) {
            row.appendChild(textElement('span', label(entry), 'chip'));
          }
          body.appendChild(row);
        });
        if (this.note) this.note.textContent = this.note.textContent.replace(/\d+ of \d+ requests.*$/, this._quota());
        if (repo.forks_count) this._deeper(body, repo);
      });
  }

  _deeper(body, repo) {
    const button = el('button', {
      type: 'button', className: 'btn btn-sm btn-outline-primary mt-2',
      textContent: `Show the ${repo.forks_count} forks of ${repo.full_name}`,
    });
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
          body.appendChild(textElement('div', error.message, 'fork-error'));
        });
    });
    body.appendChild(button);
  }
}
