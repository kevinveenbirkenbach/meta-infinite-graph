import { html } from '../html.js';
import { t } from '../i18n.js';
import { TestsCatalog } from './catalog.js';
import { RunCell, RunMark, RunPicker } from './runCard.js';

// Args (props):
//   view: the TestsView whose lines, run and hover handlers the grid draws.
export function TestsGrid({ view }) {
  const { lines, width } = view;
  const held = view._held();
  const axis = label => html`<th class="tests-axis">${label}</th>`;
  const line = entry => {
    const plan = view._plan(entry);
    const artifacts = held ? view.runs.of(entry.role, entry.variant) : [];
    return html`
      <tr class=${held && !artifacts.length ? 'tests-absent' : undefined}>
        <th class="tests-axis" data-role-name=${entry.role}>${view.roleInfo.labelNode(entry.role)}</th>
        ${axis(entry.variant === null ? t('tests.base') : String(entry.variant))}
        <th class="tests-axis" title=${plan ? undefined : t('tests.undeployed')}>
          ${plan ? String(plan.rank) : ''}
        </th>
        ${held && html`<${RunCell} artifacts=${artifacts} />`}
        ${Array.from({ length: width }, (_, index) => {
          const row = entry.cells[index];
          if (!row) return html`<td class="tests-blank"></td>`;
          if (artifacts.length) return html`<${RunMark} runs=${view.runs} row=${row} cell=${entry.keys[index]} />`;
          return html`<td class=${`pw-${row.gate}`} data-cell=${entry.keys[index]}>${TestsCatalog.STATUS[row.gate].mark}</td>`;
        })}
      </tr>
    `;
  };
  return html`
    <h2>${t('view.testsWith', { view: t(`tests.kind.${view.kind}`) })}</h2>
    ${view.kind === 'playwright' && html`<${RunPicker} view=${view} />`}
    <p class="table-note">${view.note}</p>
    <div class="table-scroll">
      ${lines && html`
        <table class="tests-matrix" onMouseOver=${event => view._hover(event)}
               onClick=${event => view._hover(event, true)} onMouseOut=${event => view._leave(event)}>
          <thead><tr>
            ${['role', 'variant', 'rank', ...(held ? ['run'] : [])].map(name => axis(t(`tests.axis.${name}`)))}
            ${Array.from({ length: width }, (_, index) => html`<th>${String(index + 1)}</th>`)}
          </tr></thead>
          <tbody>${lines.map(line)}</tbody>
        </table>
      `}
    </div>
  `;
}
