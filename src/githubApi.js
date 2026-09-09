class GitHubApi {
  constructor(ttlMs = 3600000) {
    this.ttl = ttlMs;
    this.rate = null;
    this.memory = new Map();
    this.base = 'https://api.github.com';
    this.proxied = false;
  }

  // Memoised and awaited by every request: a deep link straight into the fork
  // view otherwise fires its first calls against api.github.com before the
  // answer arrives, so a server that holds a token still gets the
  // unauthenticated limit and a 403.
  detectProxy() {
    if (!this.ready) {
      this.ready = fetch('gh-config.json', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .catch(() => null)
        .then(config => {
          this.proxied = Boolean(config && config.proxy);
          this.base = this.proxied ? '/gh' : 'https://api.github.com';
          return this.proxied;
        });
    }
    return this.ready;
  }

  static CACHE_KEY = 'mig-gh-cache';

  static TOKEN_KEY = 'mig-gh-token';

  get token() {
    try {
      return localStorage.getItem(GitHubApi.TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  set token(value) {
    try {
      if (value) localStorage.setItem(GitHubApi.TOKEN_KEY, value);
      else localStorage.removeItem(GitHubApi.TOKEN_KEY);
    } catch { /* */ }
    this._cache = null;
    this.memory.clear();
  }

  _store() {
    if (this._cache) return this._cache;
    try {
      this._cache = JSON.parse(localStorage.getItem(GitHubApi.CACHE_KEY)) || {};
    } catch {
      this._cache = {};
    }
    return this._cache;
  }

  _persist() {
    try {
      localStorage.setItem(GitHubApi.CACHE_KEY, JSON.stringify(this._cache));
    } catch { /* */ }
  }

  forget() {
    this._cache = {};
    this.memory.clear();
    this._persist();
  }

  // A 304 from a conditional request still costs one unauthenticated unit, so
  // the cache has to skip the request outright rather than revalidate it.
  cached(path) {
    const entry = this._store()[path];
    if (!entry || Date.now() - entry.at > this.ttl) return null;
    return entry.data;
  }

  // The last page of a paginated answer still carries a Link header, with
  // rel=prev and rel=first. Only the absence of rel=next ends the walk.
  static next(link) {
    if (!link) return null;
    const match = link.split(',').find(part => /rel="next"/.test(part));
    const url = match && match.match(/<([^>]+)>/);
    return url ? url[1].replace('https://api.github.com', '') : null;
  }

  // Returns: the parsed body, or throws with .status set. A 403 or 429 carrying
  // x-ratelimit-remaining: 0 is the exhausted-quota case, not a permission one.
  // Args:
  //   paginate: false stops at the first page. A caller that only draws a
  //     window must not walk the whole history: /commits on a busy repository
  //     is thousands of commits and dozens of requests.
  get(path, paginate = true) {
    const hit = this.cached(path);
    if (hit) return Promise.resolve(hit);
    if (this.memory.has(path)) return this.memory.get(path);

    const pending = this.detectProxy()
      .then(() => this._walk(path, null, paginate))
      .then(data => {
        this._store()[path] = { at: Date.now(), data };
        this._persist();
        this.memory.delete(path);
        return data;
      })
      .catch(error => {
        this.memory.delete(path);
        throw error;
      });

    this.memory.set(path, pending);
    return pending;
  }

  _walk(path, collected = null, paginate = true) {
    const headers = { Accept: 'application/vnd.github+json' };
    const token = this.proxied ? '' : this.token;
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(`${this.base}${path}`, { headers, credentials: 'omit' })
      .then(response => {
        this.rate = {
          limit: Number(response.headers.get('x-ratelimit-limit')),
          remaining: Number(response.headers.get('x-ratelimit-remaining')),
          reset: Number(response.headers.get('x-ratelimit-reset')),
        };
        if (!response.ok) {
          const error = new Error(`GitHub ${response.status} for ${path}`);
          error.status = response.status;
          error.exhausted = this.rate.remaining === 0;
          throw error;
        }
        const next = paginate ? GitHubApi.next(response.headers.get('link')) : null;
        return response.json().then(data => {
          if (!Array.isArray(data) || !next) return collected ? collected.concat(data) : data;
          return this._walk(next, (collected || []).concat(data));
        });
      });
  }

  repo(fullName) {
    return this.get(`/repos/${fullName}`);
  }

  forks(fullName) {
    return this.get(`/repos/${fullName}/forks?per_page=100&sort=oldest`);
  }

  branches(fullName) {
    return this.get(`/repos/${fullName}/branches?per_page=100`);
  }

  // One page is the whole drawable window: /commits walks the DAG, not just the
  // branch's own line, so a single call already carries the merges to draw.
  // Without a branch GitHub walks the repository's own default, which is the
  // right answer; sending sha=undefined asks for a ref that cannot exist and
  // earns a 404 that reads like a broken proxy.
  commits(fullName, branch) {
    const ref = branch ? `sha=${encodeURIComponent(branch)}&` : '';
    return this.get(`/repos/${fullName}/commits?${ref}per_page=100`, false);
  }

  commit(fullName, sha) {
    return this.get(`/repos/${fullName}/commits/${sha}`, false);
  }

  tags(fullName) {
    return this.get(`/repos/${fullName}/tags?per_page=100`);
  }
}

window.GitHubApi = GitHubApi;
