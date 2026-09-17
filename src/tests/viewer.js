import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { chrome, onEscape } from '../popup.js';

// Args:
//   url: a file under /artifacts/.
//   kind: 'video' plays it, 'report' frames the HTML report.
//   title: what the popup calls it.
export function openViewer(url, kind, title) {
  const box = document.body.appendChild(document.createElement('div'));
  box.className = 'artifact-viewer';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);
  let stopEscape = () => {};
  const close = () => {
    stopEscape();
    render(null, box);
    box.remove();
  };
  // The report's own script runs sandboxed twice over: here and by the CSP
  // header nginx sends with every file under /artifacts/.
  render(html`
    <div class="artifact-viewer-frame" onClick=${event => event.stopPropagation()}>
      <div class="artifact-viewer-head">
        <span class="artifact-viewer-title">${title}</span>
        <a href=${url} target="_blank" rel="noreferrer">${t('tests.viewer.open')}</a>
      </div>
      ${kind === 'video'
        ? html`<video class="artifact-viewer-body" src=${url} controls autoplay></video>`
        : html`<iframe class="artifact-viewer-body" src=${url} sandbox="allow-scripts" title=${title}></iframe>`}
    </div>
  `, box);
  chrome(/** @type {HTMLElement} */ (box.querySelector('.artifact-viewer-frame')), { onClose: close });
  box.addEventListener('click', close);
  stopEscape = onEscape(close);
  const button = /** @type {HTMLButtonElement} */ (box.querySelector('.popup-close'));
  if (button) button.focus();
}

// Returns: a click handler that opens url in the popup, leaving a click with
//   a modifier or another button to the browser, so a new tab stays possible.
export function viewIn(url, kind, title) {
  return event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openViewer(url, kind, title);
  };
}
