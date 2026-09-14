import { DataLoader } from './dataLoader.js';
import { byId } from './dom.js';
import { GraphRenderer } from './graphRenderer.js';
import { t } from './i18n.js';
import { SelectionManager } from './selectionManager.js';
import { CodeTests } from './tests/code/model.js';
import { UrlState } from './urlState.js';

window.addEventListener('error', e => {
  const el = document.getElementById('status');
  if (el) el.innerText = t('status.jsError', { message: e.message || e.error });
});

export const dataLoader = new DataLoader('/roles');
export const codeTests = new CodeTests('/infinito_tests');
export const selectionManager = new SelectionManager();
export const graphRenderer = new GraphRenderer('graph3d', selectionManager);

export const urlState = new UrlState();

export function facet(id) {
  return byId(id, HTMLSelectElement).value;
}

export function setFacet(id, value) {
  const select = byId(id, HTMLSelectElement);
  if ([...select.options].some(option => option.value === value)) select.value = value;
}

export function setStatus(text) {
  document.getElementById('status').innerText = text;
}
