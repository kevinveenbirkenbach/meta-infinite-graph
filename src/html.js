import htm from 'htm';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';

export const html = htm.bind(h);
export { render, useState };

// Returns: the element a stateless vnode renders to, for callers that still
//   assemble the page by hand. A vnode holding state must stay in the
//   container it was rendered into, so it never comes through here.
export function toElement(vnode) {
  const box = document.createElement('div');
  render(vnode, box);
  return box.firstChild;
}
