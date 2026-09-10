import { html, render, useState } from './vendor/preact/standalone.module.js';

export { html, render, useState };

// Returns: the element a stateless vnode renders to, for callers that still
//   assemble the page by hand. A vnode holding state must stay in the
//   container it was rendered into, so it never comes through here.
export function toElement(vnode) {
  const box = document.createElement('div');
  render(vnode, box);
  return box.firstChild;
}
