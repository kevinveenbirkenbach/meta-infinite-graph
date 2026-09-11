import { elapsed } from '../github/time.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';

const MARK = { done: '✓', failed: '✗' };

function Task({ task, now }) {
  const label = typeof task.label === 'function' ? task.label() : task.label;
  return html`
    <li class=${`loader-task loader-task-${task.state}`}>
      <span class="loader-task-mark">
        ${task.state === 'loading' ? html`<span class="cell-spin" aria-hidden="true"></span>` : MARK[task.state]}
      </span>
      <span class="loader-task-label">${label}</span>
      <span class="loader-task-time">${elapsed((task.ended || now) - task.started)}</span>
      ${task.error && task.error.message && html`
        <div class="loader-task-error">${t('loader.task.failed', { message: task.error.message })}</div>
      `}
    </li>
  `;
}

function Overview({ loader }) {
  const now = Date.now();
  const running = loader.tasks.filter(task => task.state === 'loading').length;
  const status = loader.status();
  return html`
    <div class="loader-overview-title">${t('loader.overview.title')} · ${t('loader.overview.running', { n: running })}</div>
    ${status && html`<div class="loader-overview-status">${status}</div>`}
    ${loader.tasks.length
      ? html`<ul class="loader-tasks">${loader.tasks.map(task => html`<${Task} task=${task} now=${now} />`)}</ul>`
      : html`<p class="loader-overview-none">${t('loader.overview.none')}</p>`}
  `;
}

// Args:
//   anchor: the loader in the bottom bar the overview opens from on hover or focus.
//   loader: the Loader whose tasks it lists.
export function wireLoaderOverview(anchor, loader) {
  const box = document.body.appendChild(document.createElement('div'));
  box.className = 'loader-overview';
  box.setAttribute('role', 'tooltip');
  box.id = 'loader-overview';
  box.hidden = true;
  anchor.setAttribute('aria-describedby', box.id);
  let ticker = null;

  const paint = () => {
    if (box.hidden) return;
    render(html`<${Overview} loader=${loader} />`, box);
    const place = anchor.getBoundingClientRect();
    box.style.left = `${place.left}px`;
    box.style.bottom = `${window.innerHeight - place.top + 6}px`;
  };
  const show = () => {
    box.hidden = false;
    paint();
    clearInterval(ticker);
    ticker = setInterval(paint, 1000);
  };
  const hide = () => {
    box.hidden = true;
    clearInterval(ticker);
  };

  loader.onChange = paint;
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('focus', show);
  anchor.addEventListener('mouseleave', hide);
  anchor.addEventListener('blur', hide);
  anchor.addEventListener('contextmenu', hide);
}
