import { byId } from './dom.js';
import { t } from './i18n.js';
// The time range in the bottom bar, over the local mirror served by mig/git.py.
//
// Left handle: how far back commits are pulled. At the far left it is the whole
// history. Right handle: the state every view reads, which for the tables means
// the roles tree checked out at that commit.
export class GitRange {
  static YEAR = 365 * 24 * 3600 * 1000;

  static STEPS = 1000;

  // Args:
  //   urlState: registers from, until, refs so a range survives a reload.
  //   onSources: called with the selected refs when the selection changes.
  constructor(urlState, onSources) {
    this.urlState = urlState;
    this.onSources = onSources;
    this.catalog = null;
    this.refs = [];
    this.from = null;
    this.until = null;
    // _defaults() reads these straight from the URL, before any view exists.
    // They are registered all the same, or every other capture() rebuilds the
    // query without them and drops the ticked sources.
    const none = () => {};
    urlState
      .register('refs', () => (this.catalog && this.refs.join(',') !== this.rootRef() ? this.refs.join(',') : ''), none, '')
      .register('from', () => (this.catalog && this.from !== this._back() ? new Date(this.from).toISOString() : ''), none, '')
      .register('until', () => (this.catalog && !this.latest() ? this.head() : ''), none, '');
  }

  _back() {
    return Math.max(this.span.from, this.span.to - GitRange.YEAR);
  }

  // Returns: the catalog, or null when the mirror is not served. Every caller
  // has to keep working without it, because the test harness and any deployment
  // without the git volume answer 404 here.
  load() {
    return fetch('/git/catalog')
      .then(response => (response.ok ? response.json() : null))
      .then(catalog => {
        if (!catalog || catalog.error) return null;
        this.catalog = catalog;
        this.span = {
          from: Date.parse(catalog.span.from),
          to: Date.parse(catalog.span.to),
        };
        this._defaults();
        this._render();
        return catalog;
      })
      .catch(() => null);
  }

  _defaults() {
    const params = new URLSearchParams(window.location.search);
    this.from = params.get('from') ? Date.parse(params.get('from')) : this._back();
    this.until = params.get('until') ? Date.parse(params.get('until')) : this.span.to;
    const asked = (params.get('refs') || '').split(',').filter(Boolean);
    this.refs = asked.length ? asked : [this.rootRef()];
  }

  rootRef() {
    const refs = this._rootRefs();
    const main = refs.find(ref => ref.name === 'main' || ref.name === 'master');
    return (main || refs[0] || { ref: 'HEAD' }).ref;
  }

  _rootRefs() {
    const root = (this.catalog.repos || []).find(repo => repo.remote === 'origin');
    return (root && root.refs) || [];
  }

  // Following the first ticked box instead would hand the whole app to
  // whichever fork sorts first, and an older fork has no meta/ directory.
  treeRef() {
    const own = this._rootRefs().filter(ref => this.refs.includes(ref.ref));
    return own.length ? own[0].ref : this.rootRef();
  }

  at(position) {
    return this.span.from + ((this.span.to - this.span.from) * position) / GitRange.STEPS;
  }

  position(stamp) {
    return Math.round(
      ((stamp - this.span.from) / (this.span.to - this.span.from)) * GitRange.STEPS
    );
  }

  // Returns: the ISO since for a pull, or '' at the far left, which is every
  // commit the mirror holds.
  since() {
    return this.position(this.from) <= 0 ? '' : new Date(this.from).toISOString();
  }

  head() {
    return new Date(this.until).toISOString();
  }

  // Returns: whether the right handle sits at the far right. The mirror is
  //   fetched at start and lags, so for what GitHub answers live that means up
  //   to now, not up to the newest mirrored commit.
  latest() {
    return this.position(this.until) >= GitRange.STEPS;
  }

  _render() {
    const host = document.getElementById('git-range');
    if (!host) return;
    host.hidden = false;
    this.fromInput = byId('range-from', HTMLInputElement);
    this.untilInput = byId('range-to', HTMLInputElement);
    for (const input of [this.fromInput, this.untilInput]) {
      input.min = '0';
      input.max = String(GitRange.STEPS);
    }
    this.fromInput.value = String(this.position(this.from));
    this.untilInput.value = String(this.position(this.until));
    this._sources();
    this._label();

    this.fromInput.addEventListener('input', () => {
      this.from = this.at(Number(this.fromInput.value));
      this._label();
    });
    this.untilInput.addEventListener('input', () => {
      this.until = this.at(Number(this.untilInput.value));
      this._label();
    });
    // On release, not on drag: each change is a pull and a checkout.
    for (const input of [this.fromInput, this.untilInput]) {
      input.addEventListener('change', () => this.commit());
    }
  }

  _label() {
    const label = document.getElementById('range-label');
    if (!label) return;
    const left = this.position(this.from) <= 0 ? t('range.all') : GitRange._day(this.from);
    label.textContent = `${left} → ${GitRange._day(this.until)}`;
    const warning = document.getElementById('range-warning');
    if (!warning) return;
    warning.hidden = !(this.missing && this.missing.length);
    if (warning.hidden) return;
    warning.textContent = t('range.missing', { n: this.missing.length });
    warning.title = t('range.missingTitle', { date: (this.missingAt || '').slice(0, 10), files: this.missing.join(', ') });
  }

  static _day(stamp) {
    return new Date(stamp).toISOString().slice(0, 10);
  }

  _sources() {
    const menu = document.getElementById('range-sources');
    if (!menu) return;
    menu.innerHTML = '';
    for (const repo of this.catalog.repos || []) {
      const group = document.createElement('div');
      group.className = 'range-repo';
      const title = document.createElement('div');
      title.className = 'range-repo-name';
      title.textContent = repo.full_name;
      group.appendChild(title);
      for (const ref of repo.refs) {
        const row = document.createElement('label');
        row.className = 'range-ref';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = ref.ref;
        box.checked = this.refs.includes(ref.ref);
        box.addEventListener('change', () => {
          this.refs = [...menu.querySelectorAll('input:checked')].map(one => one.getAttribute('value'));
          this.commit();
        });
        row.appendChild(box);
        row.appendChild(document.createTextNode(` ${ref.name}`));
        group.appendChild(row);
      }
      menu.appendChild(group);
    }
  }

  commit() {
    if (this.urlState) this.urlState.capture();
    if (this.onSources) this.onSources(this);
  }

  // Only the current schema is supported; the caller greys out what a commit
  // predating it cannot fill.
  static SCHEMA = ['meta/categories.yml', 'roles/'];

  static inspect(rewound) {
    if (!rewound) return Promise.resolve({ rewound: null, missing: [] });
    return Promise.all(GitRange.SCHEMA.map(
      file => fetch(`${rewound.path}${file}`)
        .then(response => (response.ok ? null : file))
        .catch(() => file)
    )).then(found => ({ rewound, missing: found.filter(Boolean) }));
  }

  markMissing(date, missing) {
    this.missing = missing;
    this.missingAt = date;
    this._label();
  }

  static rewind(until, ref) {
    return fetch(`/git/checkout?at=${encodeURIComponent(until)}&ref=${encodeURIComponent(ref)}`)
      .then(response => (response.ok ? response.json() : null))
      .then(answer => (answer && answer.path ? answer : null))
      .catch(() => null);
  }

  log(ref) {
    const since = this.since();
    const query = new URLSearchParams({ ref, until: this.head() });
    if (since) query.set('since', since);
    return fetch(`/git/log?${query}`)
      .then(response => (response.ok ? response.json() : []))
      .then(rows => (Array.isArray(rows) ? rows : []))
      .catch(() => []);
  }
}
