import { html, render } from '../html.js';
import { t } from '../i18n.js';

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
  const close = () => {
    document.removeEventListener('keydown', escape, true);
    render(null, box);
    box.remove();
  };
  const escape = event => {
    if (event.key === 'Escape') close();
  };
  // The report's own script runs sandboxed twice over: here and by the CSP
  // header nginx sends with every file under /artifacts/.
  render(html`
    <div class="artifact-viewer-frame" onClick=${event => event.stopPropagation()}>
      <div class="artifact-viewer-head">
        <span class="artifact-viewer-title">${title}</span>
        <a href=${url} target="_blank" rel="noreferrer">${t('tests.viewer.open')}</a>
        <button type="button" class="btn-close" aria-label=${t('card.close')} onClick=${close}></button>
      </div>
      ${kind === 'video'
        ? html`<video class="artifact-viewer-body" src=${url} controls autoplay></video>`
        : html`<iframe class="artifact-viewer-body" src=${url} sandbox="allow-scripts" title=${title}></iframe>`}
    </div>
  `, box);
  box.addEventListener('click', close);
  document.addEventListener('keydown', escape, true);
  const button = box.querySelector('button');
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
