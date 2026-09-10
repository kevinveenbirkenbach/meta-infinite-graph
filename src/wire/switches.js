import { byId } from '../dom.js';
import { urlState } from '../context.js';
import { MatrixModel } from '../matrix/model.js';
import { redraw } from './views.js';

export function wireDataSwitches(tableView, testsView, roleInfo, uiManager, dataLoader, roles) {
  const variantButton = byId('btn-variants', HTMLButtonElement);
  const symbolButton = byId('btn-symbols', HTMLButtonElement);
  let variantsLoaded = false;

  const setVariants = next => {
    const start = variantsLoaded
      ? Promise.resolve()
      : dataLoader.loadSideFileAll(roles, 'variants').then(raw => {
        tableView.tables.setVariants(raw);
        uiManager.setVariants(raw);
        variantsLoaded = true;
      });
    variantButton.disabled = true;
    return start.then(() => {
      tableView.variantAware = next;
      uiManager.setVariantAware(next);
      variantButton.classList.toggle('active', next);
      variantButton.title = `Variant aware: ${next ? 'on' : 'off'}`;
      variantButton.disabled = false;
      testsView.variantAware = next;
      redraw(tableView, testsView);
    });
  };

  const setSymbols = next => {
    symbolButton.disabled = true;
    return roleInfo.load().then(() => {
      roleInfo.symbols = next;
      symbolButton.textContent = next ? '🔡 Symbols' : '🔤 Text';
      symbolButton.title = next
        ? 'Show role names as symbols'
        : 'Show role names as text';
      symbolButton.classList.toggle('active', next);
      symbolButton.disabled = false;
      redraw(tableView, testsView);
    });
  };

  variantButton.addEventListener('click', () =>
    setVariants(!tableView.variantAware).then(() => urlState.capture()));
  symbolButton.addEventListener('click', () =>
    setSymbols(!roleInfo.symbols).then(() => urlState.capture()));
  return { setVariants, setSymbols };
}

export function wireControls({ testsView, matrixView, roleInfo, forkTree }) {
  testsView.onChange = () => urlState.capture();
  const choose = (id, apply) => {
    const select = byId(id, HTMLSelectElement);
    select.addEventListener('change', () => {
      apply(select.value);
      urlState.capture();
    });
  };
  choose('tests-sort', value => testsView.setSort(value));
  choose('tests-gate', value => testsView.setGate(value));
  const columnSearch = byId('matrix-columns-search', HTMLInputElement);
  columnSearch.addEventListener('input', () => matrixView.renderPicker(
    document.getElementById('matrix-columns'), columnSearch.value
  ));
  byId('matrix-columns-reset', HTMLButtonElement)
    .addEventListener('click', () => matrixView.setColumns([...MatrixModel.DEFAULT]));
  matrixView.renderPicker(document.getElementById('matrix-columns'), '');
  const resources = byId('design-resources', HTMLInputElement);
  resources.addEventListener('change', () => {
    roleInfo.resources = resources.checked;
    urlState.capture();
  });
  const tick = (id, apply) => {
    const box = byId(id, HTMLInputElement);
    box.addEventListener('change', () => apply(box.checked).then(() => urlState.capture()));
  };
  tick('design-branches', next => forkTree.setBranches(next));
  tick('design-tags', next => forkTree.setTags(next));
}
