class GitHubApi {
  constructor(ttlMs = 3600000) {
    this.ttl = ttlMs;
    this.rate = null;
    this.memory = new Map();
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
  get(path) {
    const hit = this.cached(path);
    if (hit) return Promise.resolve(hit);
    if (this.memory.has(path)) return this.memory.get(path);

    const pending = this._walk(path)
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

  _walk(path, collected = null) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    return fetch(`https://api.github.com${path}`, { headers, credentials: 'omit' })
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
        const next = GitHubApi.next(response.headers.get('link'));
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

  tags(fullName) {
    return this.get(`/repos/${fullName}/tags?per_page=100`);
  }
}

window.GitHubApi = GitHubApi;
