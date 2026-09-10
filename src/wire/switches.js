function wireDataSwitches(tableView, testsView, roleInfo, uiManager, dataLoader, roles) {
  const variantButton = document.getElementById('btn-variants');
  const symbolButton = document.getElementById('btn-symbols');
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

function wireControls({ testsView, matrixView, roleInfo, forkTree }) {
  testsView.onChange = () => urlState.capture();
  for (const [id, apply] of [
    ['tests-sort', value => testsView.setSort(value)],
    ['tests-gate', value => testsView.setGate(value)],
  ]) {
    document.getElementById(id).addEventListener('change', event => {
      apply(event.target.value);
      urlState.capture();
    });
  }
  const columnSearch = document.getElementById('matrix-columns-search');
  columnSearch.addEventListener('input', () => matrixView.renderPicker(
    document.getElementById('matrix-columns'), columnSearch.value
  ));
  document.getElementById('matrix-columns-reset')
    .addEventListener('click', () => matrixView.setColumns([...MatrixModel.DEFAULT]));
  matrixView.renderPicker(document.getElementById('matrix-columns'), '');
  const resources = document.getElementById('design-resources');
  resources.addEventListener('change', () => {
    roleInfo.resources = resources.checked;
    urlState.capture();
  });
  for (const [id, apply] of [
    ['design-branches', next => forkTree.setBranches(next)],
    ['design-tags', next => forkTree.setTags(next)],
  ]) {
    const box = document.getElementById(id);
    box.addEventListener('change', () => apply(box.checked).then(() => urlState.capture()));
  }
}
