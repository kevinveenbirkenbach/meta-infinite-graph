import { html, render } from '../html.js';
import { t } from '../i18n.js';

const RADIUS = 6;
const KEEP = 400;

// Returns: the pie slice covering fraction of the circle, clockwise from twelve.
function slice(fraction) {
  const angle = fraction * 2 * Math.PI;
  const x = (8 + RADIUS * Math.sin(angle)).toFixed(2);
  const y = (8 - RADIUS * Math.cos(angle)).toFixed(2);
  return `M 8 8 L 8 ${8 - RADIUS} A ${RADIUS} ${RADIUS} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}

export class Loader {
  // Args:
  //   element: the spot in the bottom bar the indicator draws into.
  constructor(element) {
    this.element = element;
    this.view = null;
    this.pending = new Map();
    this.tasks = [];
    this.elapsed = null;
    this.seconds = 0;
    this.paused = false;
    this.onChange = null;
    this.draw();
  }

  // Args:
  //   view: the view the work belongs to, '*' for every view, or null for
  //     work that is listed but never turns the circle.
  //   result: what the work returned; only a promise is waited for.
  //   label: what the overview calls it, or () => that text as it changes.
  //   retry: runs the same work again, offered on the failed task.
  // Returns: result, untouched.
  track(view, result, label = /** @type {string | (() => string)} */ (''), retry = null) {
    if (!result || typeof result.then !== 'function') return result;
    const task = { view, label, retry, state: 'loading', started: Date.now(), ended: null, error: null };
    this.tasks.unshift(task);
    const finished = this.tasks.filter(one => one.state !== 'loading');
    for (const stale of finished.slice(KEEP)) this.tasks.splice(this.tasks.indexOf(stale), 1);
    if (view !== null) this.pending.set(view, (this.pending.get(view) || 0) + 1);
    this.draw();
    const done = error => {
      Object.assign(task, { state: error ? 'failed' : 'done', error, ended: Date.now() });
      if (view !== null) this.pending.set(view, this.pending.get(view) - 1);
      this.draw();
    };
    result.then(() => done(null), error => done(error || new Error('')));
    return result;
  }

  show(view) {
    this.view = view;
    this.draw();
  }

  // Args:
  //   elapsed: the share of the refresh interval already gone, or null for
  //     a view that does not refresh.
  //   seconds: the seconds still to wait, for status().
  //   paused: whether the last refresh was skipped to spare the quota.
  countdown(elapsed, seconds = 0, paused = false) {
    this.elapsed = elapsed;
    this.seconds = seconds;
    this.paused = paused;
    this.draw();
  }

  busy() {
    return (this.pending.get(this.view) || 0) + (this.pending.get('*') || 0) > 0;
  }

  // Returns: what the circle shows right now, in words, or '' when it rests.
  status() {
    if (this.busy()) return t('loader.loading');
    if (this.elapsed === null) return '';
    return t(this.paused ? 'loader.paused' : 'loader.next', { n: this.seconds });
  }

  draw() {
    const busy = this.busy();
    const counting = !busy && this.elapsed !== null;
    this.element.setAttribute('aria-label', [this.status(), t('loader.menu.hint')].filter(Boolean).join(' · '));
    this.element.dataset.state = busy ? 'loading' : counting ? 'waiting' : 'idle';
    const fill = !counting ? null
      : this.elapsed >= 0.999 ? html`<circle class="loader-fill" cx="8" cy="8" r=${RADIUS} />`
        : html`<path class="loader-fill" d=${slice(this.elapsed)} />`;
    render(html`<svg class=${busy ? 'loader-spin' : 'loader-pie'} viewBox="0 0 16 16" aria-hidden="true">
      <circle class="loader-track" cx="8" cy="8" r=${RADIUS} />
      ${busy ? html`<circle class="loader-arc" cx="8" cy="8" r=${RADIUS} />` : fill}
    </svg>`, this.element);
    if (this.onChange) this.onChange();
  }
}
