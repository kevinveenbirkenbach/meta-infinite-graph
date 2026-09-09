class ForkGraph {
  // Args:
  //   repos: [{ full_name, created_at, pushed_at, parent }] with parent the
  //     full_name this one was forked from, or null for the root.
  //   commits: full_name -> [{ sha, parents, date, branch, message }], the
  //     branch histories of the repos that were opened. Absent for the rest.
  constructor(repos, commits = {}) {
    this.repos = repos;
    this.commits = commits;
  }

  static _time(iso) {
    const value = Date.parse(iso || '');
    return Number.isNaN(value) ? null : value;
  }

  // With a history loaded the axis narrows to it: a fork network spans years
  // and a commit page spans days, so on one scale every dot of that page lands
  // on the same pixel. Lines outside the window are clamped, not dropped.
  span() {
    const stamps = [];
    const histories = Object.values(this.commits).filter(history => history && history.length);
    if (histories.length) {
      for (const history of histories) {
        for (const commit of history) stamps.push(ForkGraph._time(commit.date));
      }
    } else {
      for (const repo of this.repos) {
        stamps.push(ForkGraph._time(repo.created_at), ForkGraph._time(repo.pushed_at));
      }
    }
    const known = stamps.filter(value => value !== null);
    if (!known.length) return null;
    const from = Math.min(...known);
    const to = Math.max(...known);
    return { from, to: to > from ? to : from + 1, zoomed: histories.length > 0 };
  }

  // Returns: one row per repo in fork order, each carrying the commit columns
  //   of assign() when that repo's history was fetched. A repo's own row comes
  //   first, so a fork edge always has a row to leave from.
  rows() {
    const rows = [];
    const children = new Map();
    for (const repo of this.repos) {
      if (!children.has(repo.parent)) children.set(repo.parent, []);
      children.get(repo.parent).push(repo);
    }
    const walk = repo => {
      const graph = ForkGraph.assign(this.commits[repo.full_name]);
      rows.push({
        id: repo.full_name,
        parent: repo.parent,
        from: ForkGraph._time(repo.created_at),
        to: ForkGraph._time(repo.pushed_at),
        columns: graph.lanes,
        merges: graph.edges,
      });
      for (const child of children.get(repo.full_name) || []) walk(child);
    };
    for (const root of children.get(null) || []) walk(root);
    return rows;
  }

  // Args:
  //   history: the repo's commits, newest first, as /commits returns them.
  // Returns: { lanes, edges }. The first-parent chain from the tip is the
  //   trunk; every further parent of a merge opens a side lane that runs by
  //   first parent until it meets a commit already placed. A side lane is
  //   reused once its commits are all older than the one that needs it, so a
  //   repo that merges single-commit pull requests draws a few columns, not
  //   one per pull request.
  static assign(history) {
    if (!history || !history.length) return { lanes: [], edges: [] };
    const commits = new Map(history.map(commit => [commit.sha, commit]));
    const lane = new Map();
    const columns = [];

    const chain = (head, column) => {
      const walked = [];
      let sha = head;
      while (sha && commits.has(sha) && !lane.has(sha)) {
        lane.set(sha, column);
        walked.push(sha);
        sha = (commits.get(sha).parents || [])[0];
      }
      return { walked, joins: sha && commits.has(sha) ? sha : null };
    };

    const trunk = chain(history[0].sha, 0);
    columns.push({ commits: trunk.walked, until: null });

    const edges = [];
    for (const sha of trunk.walked) {
      for (const parent of (commits.get(sha).parents || []).slice(1)) {
        if (!commits.has(parent) || lane.has(parent)) continue;
        const at = ForkGraph._time(commits.get(sha).date);
        let column = columns.findIndex(
          (held, index) => index > 0 && held.until !== null && held.until >= at
        );
        if (column === -1) {
          column = columns.length;
          columns.push({ commits: [], until: null });
        }
        const side = chain(parent, column);
        columns[column].commits.push(...side.walked);
        const stamps = side.walked.map(w => ForkGraph._time(commits.get(w).date));
        columns[column].until = stamps.length ? Math.min(...stamps) : at;
        edges.push({ kind: 'merge', from: column, to: 0, at, sha });
      }
    }

    const lanes = columns.map((held, index) => {
      const stamps = held.commits.map(sha => ForkGraph._time(commits.get(sha).date))
        .filter(value => value !== null);
      return {
        column: index,
        commits: held.commits.map(sha => commits.get(sha)),
        from: stamps.length ? Math.min(...stamps) : null,
        to: stamps.length ? Math.max(...stamps) : null,
      };
    });
    return { lanes, edges, placed: lane.size, total: commits.size };
  }

  // Returns: [{ from, to, at }], one per fork, leaving the parent row at the
  //   moment the fork was created. Merge edges are per row and come from
  //   assign(), because a merge never crosses a repository boundary here.
  static forks(rows) {
    const known = new Set(rows.map(row => row.id));
    return rows
      .filter(row => row.parent && known.has(row.parent))
      .map(row => ({ from: row.parent, to: row.id, at: row.from }));
  }
}

window.ForkGraph = ForkGraph;
