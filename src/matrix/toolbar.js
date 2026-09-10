import { html } from '../html.js';
import { MatrixModel } from './model.js';

export class MatrixToolbar {
  constructor(matrix) {
    this.matrix = matrix;
    this.timer = null;
  }

  _search(event) {
    const { value } = event.currentTarget;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.matrix.setFind(value), 150);
  }

  render() {
    const { matrix } = this;
    const current = matrix.columns.join(',');
    const toggle = (name, label, active, action, title) => html`
      <button type="button" class=${active ? 'btn btn-outline-secondary active' : 'btn btn-outline-secondary'}
              data-preset=${name} aria-pressed=${String(active)} title=${title} onClick=${action}>${label}</button>
    `;
    return html`
      <div class="matrix-toolbar">
        <input type="search" id="matrix-find" class="form-control form-control-sm"
               placeholder="Search the visible columns …" value=${matrix.find} onInput=${event => this._search(event)} />
        <div class="btn-group btn-group-sm matrix-presets">
          ${Object.entries(MatrixModel.PRESETS).map(([name, { label, columns }]) => toggle(
            name, label, !matrix.complexity && columns.join(',') === current, () => matrix.preset(name)
          ))}
          ${toggle('complexity', 'Complexity', matrix.complexity, () => matrix.setComplexity(!matrix.complexity),
            'Adds the complexity columns and orders the rows heaviest first.')}
        </div>
        <button type="button" id="matrix-columns-button" class="btn btn-sm btn-outline-secondary" onClick=${event => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          matrix.panels.picker(box.left, box.bottom + 4);
        }}>${`Columns ${matrix.columns.length}/${matrix.model.catalogue(matrix.columns).length} ▾`}</button>
        <div class="btn-group btn-group-sm">
          ${[['compact', 'Compact'], ['comfort', 'Comfort']].map(([value, label]) => html`
            <button type="button" class=${matrix.density === value ? 'btn btn-outline-secondary active' : 'btn btn-outline-secondary'}
                    data-density=${value} onClick=${() => matrix.setDensity(value)}>${label}</button>
          `)}
        </div>
        <button type="button" id="matrix-csv" class="btn btn-sm btn-outline-secondary"
                title="Download the rows and columns shown, in their order" onClick=${() => matrix.download()}>CSV</button>
      </div>
    `;
  }
}
