import { html, render } from '../html.js';

// Args:
//   anchor: the loader the menu opens from, by right click or from the keyboard.
//   items: () => the entries for the view on screen, each { label, run, checked },
//     { header } or { divider: true }.
export function wireLoaderMenu(anchor, items) {
  const box = document.body.appendChild(document.createElement('div'));
  box.className = 'dropdown-menu loader-menu';
  box.setAttribute('role', 'menu');

  const close = () => {
    box.classList.remove('show');
    render(null, box);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
  const outside = event => {
    if (!box.contains(/** @type {Node} */ (event.target))) close();
  };
  const escape = event => {
    if (event.key !== 'Escape') return;
    close();
    anchor.focus();
  };
  const entry = item => {
    if (item.divider) return html`<div class="dropdown-divider"></div>`;
    if (item.header) return html`<h6 class="dropdown-header">${item.header}</h6>`;
    const run = () => {
      close();
      item.run();
    };
    const radio = 'checked' in item;
    return html`<button type="button" role=${radio ? 'menuitemradio' : 'menuitem'}
      aria-checked=${radio ? String(item.checked) : undefined}
      class=${`dropdown-item${item.checked ? ' active' : ''}`} onClick=${run}>${item.label}</button>`;
  };
  const open = () => {
    const place = anchor.getBoundingClientRect();
    render(html`${items().map(entry)}`, box);
    box.style.left = `${place.left}px`;
    box.style.bottom = `${window.innerHeight - place.top + 4}px`;
    box.classList.add('show');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    const first = box.querySelector('button');
    if (first) first.focus();
  };

  anchor.addEventListener('contextmenu', event => {
    event.preventDefault();
    open();
  });
  anchor.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && event.key !== 'Enter' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    open();
  });
}
