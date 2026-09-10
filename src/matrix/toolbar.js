class MatrixToolbar {
  constructor(matrix) {
    this.matrix = matrix;
  }

  static _button(label, props) {
    return el('button', {
      type: 'button', className: 'btn btn-outline-secondary', textContent: label, ...props,
    });
  }

  render() {
    const { matrix } = this;
    const bar = el('div', { className: 'matrix-toolbar' });

    const search = el('input', {
      type: 'search', id: 'matrix-find', className: 'form-control form-control-sm',
      placeholder: 'Search the visible columns …', value: matrix.find,
    });
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => matrix.setFind(search.value), 150);
    });
    bar.appendChild(search);

    const presets = el('div', { className: 'btn-group btn-group-sm matrix-presets' });
    const current = matrix.columns.join(',');
    const toggle = (name, label, active, action, props) => {
      const chip = MatrixToolbar._button(label, props);
      chip.dataset.preset = name;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
      chip.addEventListener('click', action);
      presets.appendChild(chip);
    };
    for (const [name, [label, columns]] of Object.entries(MatrixModel.PRESETS)) {
      toggle(name, label, !matrix.complexity && columns.join(',') === current, () => matrix.preset(name), {});
    }
    toggle('complexity', 'Complexity', matrix.complexity, () => matrix.setComplexity(!matrix.complexity), {
      title: 'Adds the complexity columns and orders the rows heaviest first.',
    });
    bar.appendChild(presets);

    const columns = MatrixToolbar._button(
      `Columns ${matrix.columns.length}/${matrix.model.catalogue(matrix.columns).length} ▾`,
      { id: 'matrix-columns-button', className: 'btn btn-sm btn-outline-secondary' }
    );
    columns.addEventListener('click', event => {
      event.stopPropagation();
      const box = columns.getBoundingClientRect();
      matrix.panels.picker(box.left, box.bottom + 4);
    });
    bar.appendChild(columns);

    const density = el('div', { className: 'btn-group btn-group-sm' });
    for (const [value, label] of [['compact', 'Compact'], ['comfort', 'Comfort']]) {
      const button = MatrixToolbar._button(label, {});
      button.dataset.density = value;
      button.classList.toggle('active', matrix.density === value);
      button.addEventListener('click', () => matrix.setDensity(value));
      density.appendChild(button);
    }
    bar.appendChild(density);

    const csv = MatrixToolbar._button('CSV', {
      id: 'matrix-csv', className: 'btn btn-sm btn-outline-secondary',
      title: 'Download the rows and columns shown, in their order',
    });
    csv.addEventListener('click', () => matrix.download());
    bar.appendChild(csv);
    return bar;
  }
}

window.MatrixToolbar = MatrixToolbar;
