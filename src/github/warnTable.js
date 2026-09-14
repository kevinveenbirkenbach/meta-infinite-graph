import { html } from '../html.js';
import { t } from '../i18n.js';

export const LEVELS = ['failure', 'warning', 'notice'];

function Filters({ options, filters, onFilter }) {
  const active = Object.values(filters).some(Boolean);
  const facets = ['level', 'job', 'repository'].map(name => [name, t(`warnings.column.${name}`)]);
  return html`
    <div class="feed-filters">
      <input type="search" class="form-control form-control-sm feed-search" value=${filters.search}
             placeholder=${t('feed.filter.search')} aria-label=${t('feed.filter.search')}
             onInput=${event => onFilter('search', event.currentTarget.value)} />
      ${facets.map(([name, label]) => html`
        <label class="feed-filter">
          <span>${label}</span>
          <select class="form-select form-select-sm" data-filter=${name}
                  onChange=${event => onFilter(name, event.currentTarget.value)}>
            <option value="">${t('feed.filter.all')}</option>
            ${(options[name] || []).map(([value, count]) => html`
              <option value=${value} selected=${filters[name] === value}>
                ${`${name === 'level' ? t(`warnings.level.${value}`) : value} (${count})`}
              </option>
            `)}
          </select>
        </label>
      `)}
      ${active && html`
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick=${() => onFilter(null, '')}>
          ${t('feed.filter.clear')}
        </button>
      `}
    </div>
  `;
}

// Args (props):
//   runs: [{ repo, run, done, total, failed }] for every run being read.
//   entries: the annotations to draw, already narrowed, or null while asking.
//   options: facet name -> [[value, count]] over every annotation read.
export function WarningTable({ note, runs, entries, options, filters, onFilter }) {
  const where = entry => (entry.path ? `${entry.path}${entry.line ? `:${entry.line}` : ''}` : '');
  const source = entry => {
    const sha = entry.run.head_sha || entry.run.head_branch;
    return sha ? `https://github.com/${entry.repo}/blob/${sha}/${entry.path}#L${entry.line || 1}` : '';
  };
  const row = entry => html`
    <tr>
      <td class=${`feed-mark warn-${entry.level}`}>${t(`warnings.level.${entry.level}`)}</td>
      <td>${entry.repo}</td>
      <td>${`#${entry.run.run_number}`}</td>
      <td><a href=${entry.jobUrl} target="_blank" rel="noreferrer">${entry.job}</a></td>
      <td>
        ${entry.path && source(entry)
          ? html`<a href=${source(entry)} target="_blank" rel="noreferrer">${where(entry)}</a>`
          : where(entry)}
      </td>
      <td>${entry.title}</td>
      <td class="warn-message">${entry.message}</td>
    </tr>
  `;
  return html`
    <h2>${t('view.warnings')}</h2>
    <${Filters} options=${options} filters=${filters} onFilter=${onFilter} />
    <p class="table-note">${note}</p>
    ${runs.length > 0 && html`
      <ul class="warn-runs">
        ${runs.map(state => html`
          <li class=${state.failed ? 'warn-run-failed' : ''}>
            ${t('warnings.run', {
              repo: state.repo, run: `#${state.run.run_number}`, done: state.done, n: state.total,
            })}
            ${state.failed ? ` ${state.failed.message}` : ''}
          </li>
        `)}
      </ul>
    `}
    <div>
      ${entries && html`
        <table class="table table-sm feed-table warn-table">
          <thead><tr>
            ${['level', 'repository', 'run', 'job', 'where', 'title', 'message']
              .map(column => html`<th>${t(`warnings.column.${column}`)}</th>`)}
          </tr></thead>
          <tbody>${entries.map(row)}</tbody>
        </table>
      `}
    </div>
  `;
}
