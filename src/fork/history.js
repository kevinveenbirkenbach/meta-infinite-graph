export class ForkHistory {
  // A tag carries no date, so each one outside the fetched commits costs its
  // own request, and an unauthenticated visitor has 60 for the whole hour.
  static TAG_RESERVE = 200;

  constructor(api) {
    this.api = api;
    this.branches = true;
    this.tags = false;
    this.range = null;
    this.network = null;
    this.histories = null;
    this.tagsBy = null;
    this.refused = null;
  }

  _plot() {
    throw new Error('ForkHistory draws nothing itself; a subclass provides _plot()');
  }

  useMirror(range) {
    this.range = range && range.catalog ? range : null;
  }

  _mirrored(fullName) {
    if (!this.range) return null;
    return (this.range.catalog.repos || []).find(repo => repo.full_name === fullName) || null;
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

  // Args:
  //   next: whether the plot should carry tag marks.
  // Returns: a promise for the redraw, so a caller can wait for the fetches.
  setTags(next) {
    this.tags = next;
    if (!this.network) return Promise.resolve();
    if (!next) {
      this.tagsBy = {};
      this._plot();
      return Promise.resolve();
    }
    return this._allTags();
  }

  _allTags() {
    if (!this.tags || !this.network) return Promise.resolve();
    return this.network.reduce(
      (chain, repo) => chain.then(() => (this.refused ? null : this._tagsOf(repo))),
      Promise.resolve()
    ).then(() => this._plot());
  }

  _lookups() {
    const rate = this.api.rate;
    const left = rate && rate.remaining ? rate.remaining : 60;
    return Math.max(4, left - ForkHistory.TAG_RESERVE);
  }

  _tagsOf(repo) {
    if (!this.tagsBy || repo.full_name in this.tagsBy) return Promise.resolve();
    this.tagsBy[repo.full_name] = [];
    if (this._mirrored(repo.full_name)) {
      if (repo.full_name === this.range.catalog.root) {
        this.tagsBy[repo.full_name] = this.range.catalog.tags || [];
      }
      return Promise.resolve();
    }
    return this.api.tags(repo.full_name)
      .then(tags => {
        const known = new Set((this.histories[repo.full_name] || []).map(c => c.sha));
        const listed = tags.map(tag => ({ name: tag.name, sha: tag.commit && tag.commit.sha }));
        this.tagsBy[repo.full_name] = listed;
        const missing = listed.filter(tag => tag.sha && !known.has(tag.sha));
        return Promise.all(missing.slice(0, this._lookups()).map(
          tag => this.api.commit(repo.full_name, tag.sha)
            .then(commit => { tag.date = commit.commit.committer.date; })
            .catch(() => null)
        ));
      })
      .catch(error => {
        delete this.tagsBy[repo.full_name];
        this.refused = error;
      });
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
    const mirrored = this._mirrored(repo.full_name);
    if (mirrored) return this._mirrorHistory(repo, mirrored);
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

  _mirrorHistory(repo, mirrored) {
    const wanted = mirrored.refs
      .filter(ref => this.range.refs.includes(ref.ref))
      .map(ref => ref.ref);
    if (!wanted.length) return Promise.resolve();
    return Promise.all(wanted.map(ref => this.range.log(ref)))
      .then(walks => {
        const seen = new Map();
        for (const walk of walks) {
          for (const commit of walk) if (!seen.has(commit.sha)) seen.set(commit.sha, commit);
        }
        this.histories[repo.full_name] = [...seen.values()]
          .sort((one, other) => Date.parse(other.date) - Date.parse(one.date));
        this._plot();
      })
      .catch(error => {
        delete this.histories[repo.full_name];
        this.refused = error;
      });
  }
}
