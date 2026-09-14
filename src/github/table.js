import { html } from '../html.js';
import { t } from '../i18n.js';

function Filters({ spec, options, filters, onFilter }) {
  const active = Object.values(filters).some(Boolean);
  return html`
    <div class="feed-filters">
      <input type="search" class="form-control form-control-sm feed-search" value=${filters.search}
             placeholder=${t('feed.filter.search')} aria-label=${t('feed.filter.search')}
             onInput=${event => onFilter('search', event.currentTarget.value)} />
      ${spec.facets.map(facet => {
        const listed = options[facet.name] || [];
        const values = filters[facet.name] && !listed.some(([value]) => value === filters[facet.name])
          ? [[filters[facet.name], 0], ...listed] : listed;
        return html`
          <label class="feed-filter">
            <span>${facet.label}</span>
            <select class="form-select form-select-sm" data-filter=${facet.name}
                    onChange=${event => onFilter(facet.name, event.currentTarget.value)}>
              <option value="">${t('feed.filter.all')}</option>
              ${values.map(([value, count]) => html`
                <option value=${value} selected=${filters[facet.name] === value}>${`${value} (${count})`}</option>
              `)}
            </select>
          </label>
        `;
      })}
      ${active && html`
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => onFilter(null, '')}>
          ${t('feed.filter.clear')}
        </button>
      `}
    </div>
  `;
}

// Args (props):
//   entries: the rows to draw, already narrowed, or null while asking.
//   options: facet name -> [[value, count]] over the rows the window keeps.
//   filters: facet name and 'search' -> the value in force, '' for none.
//   onFilter: (name, value) => void; a null name clears every filter.
//   onPick: (entry, view) => void for a feed whose rows open something, else null.
export function FeedTable({ spec, note, entries, options, filters, onFilter, onPick }) {
  const jumps = onPick ? spec.jumps || [] : [];
  const cell = (entry, value, index) => {
    if (index === spec.markAt) return html`<td class=${`feed-mark feed-${spec.mark(entry)}`}>${value}</td>`;
    if (index === spec.linkAt && spec.link(entry)) {
      return html`<td><a href=${spec.link(entry)} target="_blank" rel="noreferrer">${value}</a></td>`;
    }
    return html`<td>${value}</td>`;
  };
  const jump = entry => html`
    <td class="feed-jumps">
      ${jumps.map(one => html`
        <button type="button" class="btn btn-sm btn-outline-secondary" title=${t(`feed.actions.jump.${one.view}`)}
                onClick=${event => { event.stopPropagation(); onPick(entry, one.view); }}>${one.mark}</button>
      `)}
    </td>
  `;
  const row = entry => {
    const cells = spec.cells(entry).map((value, index) => cell(entry, value, index));
    if (jumps.length) cells.push(jump(entry));
    if (!onPick) return html`<tr>${cells}</tr>`;
    const pick = event => {
      if (!(event.target instanceof Element && event.target.closest('a'))) onPick(entry);
    };
    return html`<tr class="feed-pickable" title=${t('feed.actions.pick')} onClick=${pick}>${cells}</tr>`;
  };
  return html`
    <h2>${spec.title}</h2>
    ${spec.facets && html`<${Filters} spec=${spec} options=${options} filters=${filters} onFilter=${onFilter} />`}
    <p class="table-note">${note}</p>
    <div>
      ${entries && html`
        <table class="table table-sm feed-table">
          <thead><tr>
            ${spec.columns.map(title => html`<th>${title}</th>`)}
            ${jumps.length > 0 && html`<th>${t('feed.actions.open')}</th>`}
          </tr></thead>
          <tbody>
            ${entries.map(row)}
          </tbody>
        </table>
      `}
    </div>
  `;
}
