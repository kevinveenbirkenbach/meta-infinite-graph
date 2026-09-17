import { el, textElement } from '../dom.js';
import { t } from '../i18n.js';
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
    this.opened = new Set();
    this.branchesBy = {};
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
    section.appendChild(textElement('h2', t('view.forks')));
    this.note = textElement('p', t('forks.reading', { repo: this.root }), 'table-note');
    section.appendChild(this.note);
    this.plot = el('div', { className: 'fork-plot-host' });
    section.appendChild(this.plot);
    return section;
  }

  _load() {
    return Promise.all([this.api.repo(this.root), this.api.forks(this.root)])
      .then(([repo, forks]) => {
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
    const shown = Object.fromEntries([...this.opened].map(name => [name, this.branchesBy[name] || []]));
    const graph = new ForkGraph(this.network, this.histories, this.tagsBy, shown);
    const drawn = ForkPlot.draw(graph, this.plot.clientWidth || 900, (commit, repo, event, now) => {
      if (!commit) return this.cards.release(ForkCards.COMMIT);
      this._point = { x: event.clientX, y: event.clientY };
      this.cards.show(ForkCards.COMMIT, this._point, () => ForkCards.commitCard(commit, repo), now);
    }, name => this.toggle(name));
    const focused = this.plot.contains(document.activeElement) ? document.activeElement.getAttribute('data-repo') : null;
    this.plot.innerHTML = '';
    if (!drawn) return;
    this.plot.appendChild(drawn.svg);
    if (focused) {
      /** @type {SVGElement | null} */ (drawn.svg.querySelector(`[data-repo="${CSS.escape(focused)}"]`))?.focus();
    }
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

  // Args:
  //   fullName: the repository whose branch rows to show or hide.
  // Returns: a promise for the redraw once its branches have loaded.
  toggle(fullName) {
    if (this.opened.has(fullName)) this.opened.delete(fullName);
    else this.opened.add(fullName);
    this._plot();
    const repo = this.network.find(one => one.full_name === fullName);
    if (!repo || !this.opened.has(fullName)) return Promise.resolve();
    return this._branchesOf(repo).then(() => this._deeper(repo)).then(() => {
      this._plot();
      if (this.summary) this.note.textContent = `${this.summary} ${this._quota()}`;
    });
  }

  _deeper(repo) {
    if (!repo.forks_count || this.network.some(one => one.parent === repo.full_name)) return Promise.resolve();
    return this.api.forks(repo.full_name)
      .then(forks => {
        this.network.push(...forks.map(fork => ({ ...fork, parent: repo.full_name })));
        return this._allHistories().then(() => this._allTags());
      })
      .catch(error => { this.refused = error; });
  }

  _describe(repo, forks) {
    const deeper = forks.filter(fork => fork.forks_count > 0).length;
    this.summary = [
      t('forks.direct', { n: forks.length, repo: repo.full_name }),
      deeper ? t('forks.deeper', { n: deeper }) : t('forks.leaves'),
      t('forks.lazy'),
    ].join(' ');
    this.note.textContent = `${this.summary} ${this._quota()}`;
  }

  // Three cases, not two: in proxied mode api.token is deliberately empty
  // because the server holds it, so reading that alone would report the
  // authenticated 5000 ceiling as "unauthenticated".
  _quota() {
    const rate = this.api.rate;
    if (!rate || !rate.limit) return '';
    const scope = this.api.proxied ? 'server' : this.api.token ? 'token' : 'none';
    return t('forks.quota', { remaining: rate.remaining, limit: rate.limit, scope: t(`forks.scope.${scope}`) });
  }

  _fail(error) {
    this.note.textContent = error.exhausted
      ? t('forks.exhausted')
      : t('forks.answered', { status: error.status || t('feed.anError'), message: error.message });
  }
}
