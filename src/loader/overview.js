import { elapsed } from '../github/time.js';
import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { chrome, hideLater, waiting } from '../popup.js';

const MARK = { done: '✓', failed: '✗' };
const PAGE = 20;

function Task({ task, now, again }) {
  const label = typeof task.label === 'function' ? task.label() : task.label;
  return html`
    <li class=${`loader-task loader-task-${task.state}`}>
      <span class="loader-task-mark">
        ${task.state === 'loading' ? html`<span class="cell-spin" aria-hidden="true"></span>` : MARK[task.state]}
      </span>
      <span class="loader-task-label">${label}</span>
      <span class="loader-task-time">${elapsed((task.ended || now) - task.started)}</span>
      ${task.error && task.error.message && html`
        <div class="loader-task-error">
          ${t('loader.task.failed', { message: task.error.message })}
          ${task.retry && html`
            <button type="button" class="btn btn-sm btn-outline-secondary loader-task-retry"
                    onClick=${() => again(task)}>${t('loader.task.retry')}</button>
          `}
        </div>
      `}
    </li>
  `;
}

// Args (props):
//   page: which page of the history to draw, 0 being the newest.
//   turn: (page) => void, for the buttons that leaf through it.
function Overview({ loader, page, turn, again }) {
  const now = Date.now();
  const running = loader.tasks.filter(task => task.state === 'loading').length;
  const status = loader.status();
  const pages = Math.max(1, Math.ceil(loader.tasks.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = loader.tasks.slice(at * PAGE, at * PAGE + PAGE);
  return html`
    <div class="loader-overview-title">${t('loader.overview.title')} · ${t('loader.overview.running', { n: running })}</div>
    ${status && html`<div class="loader-overview-status">${status}</div>`}
    ${loader.tasks.length
      ? html`
        <ul class="loader-tasks">
          ${shown.map(task => html`<${Task} task=${task} now=${now} again=${again} />`)}
        </ul>
        ${pages > 1 && html`
          <div class="loader-pager">
            <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${at === 0}
                    onClick=${() => turn(at - 1)}>${t('loader.overview.newer')}</button>
            <span>${t('loader.overview.page', { page: at + 1, pages })}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary" disabled=${at >= pages - 1}
                    onClick=${() => turn(at + 1)}>${t('loader.overview.older')}</button>
          </div>
        `}
      `
      : html`<p class="loader-overview-none">${t('loader.overview.none')}</p>`}
  `;
}

// Args:
//   anchor: the loader in the bottom bar the overview opens from on hover or focus.
//   loader: the Loader whose tasks it lists.
export function wireLoaderOverview(anchor, loader) {
  const box = document.body.appendChild(document.createElement('div'));
  box.className = 'loader-overview popup-fade';
  box.setAttribute('role', 'tooltip');
  box.id = 'loader-overview';
  box.hidden = true;
  anchor.setAttribute('aria-describedby', box.id);
  const list = box.appendChild(document.createElement('div'));
  let ticker = null;
  let leaving = null;
  let page = 0;

  const turn = to => {
    page = Math.max(0, to);
    paint();
  };
  const again = task => {
    task.retry();
    page = 0;
    paint();
  };
  const paint = () => {
    if (box.hidden) return;
    render(html`<${Overview} loader=${loader} page=${page} turn=${turn} again=${again} />`, list);
    if (bar.state === 'maximized') return;
    const place = anchor.getBoundingClientRect();
    box.style.left = `${place.left}px`;
    box.style.bottom = `${window.innerHeight - place.top + 6}px`;
  };
  const waits = waiting();
  const hide = () => {
    waits.cancel(box.id);
    box.hidden = true;
    box.classList.remove('on', 'fading');
    clearInterval(ticker);
    leaving = null;
  };
  const show = () => {
    if (leaving) leaving.cancel();
    leaving = null;
    if (box.hidden) page = 0;
    box.hidden = false;
    box.classList.add('on');
    paint();
    clearInterval(ticker);
    ticker = setInterval(paint, 1000);
  };
  const bar = chrome(box, { onClose: hide, onState: () => paint() });
  const rest = () => (box.hidden ? waits.arm(box.id, show) : show());
  const leave = () => {
    waits.cancel(box.id);
    if (box.hidden || bar.state) return;
    if (leaving) leaving.cancel();
    leaving = hideLater(box, hide);
  };

  loader.onChange = paint;
  box.addEventListener('mouseenter', show);
  box.addEventListener('mouseleave', leave);
  anchor.addEventListener('mouseenter', rest);
  anchor.addEventListener('click', show);
  anchor.addEventListener('focus', show);
  anchor.addEventListener('mouseleave', leave);
  anchor.addEventListener('blur', leave);
  anchor.addEventListener('contextmenu', hide);
}
