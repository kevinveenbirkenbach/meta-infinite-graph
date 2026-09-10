import { html } from '../html.js';
import { t } from '../i18n.js';
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
               placeholder=${t('matrix.search')} value=${matrix.find} onInput=${event => this._search(event)} />
        <div class="btn-group btn-group-sm matrix-presets">
          ${Object.entries(MatrixModel.PRESETS).map(([name, { label, columns }]) => toggle(
            name, label, !matrix.complexity && columns.join(',') === current, () => matrix.preset(name)
          ))}
          ${toggle('complexity', t('matrix.complexity'), matrix.complexity, () => matrix.setComplexity(!matrix.complexity),
            t('matrix.complexityTitle'))}
        </div>
        <button type="button" id="matrix-columns-button" class="btn btn-sm btn-outline-secondary" onClick=${event => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          matrix.panels.picker(box.left, box.bottom + 4);
        }}>${t('matrix.columnsButton', { shown: matrix.columns.length, all: matrix.model.catalogue(matrix.columns).length })}</button>
        <div class="btn-group btn-group-sm">
          ${['compact', 'comfort'].map(value => html`
            <button type="button" class=${matrix.density === value ? 'btn btn-outline-secondary active' : 'btn btn-outline-secondary'}
                    data-density=${value} onClick=${() => matrix.setDensity(value)}>${t(`matrix.density.${value}`)}</button>
          `)}
        </div>
        <button type="button" id="matrix-csv" class="btn btn-sm btn-outline-secondary"
                title=${t('matrix.csvTitle')} onClick=${() => matrix.download()}>CSV</button>
      </div>
    `;
  }
}
