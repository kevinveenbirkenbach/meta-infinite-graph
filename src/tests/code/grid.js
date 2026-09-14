import { html } from '../../html.js';
import { t } from '../../i18n.js';

// Args (props):
//   view: the CodeTestsView whose files and cases the table draws.
export function CodeGrid({ view }) {
  const { files } = view;
  const row = file => {
    const cases = view.codeTests.known(file);
    const open = view.open === file.path;
    return html`
      <tr class=${`code-row${open ? ' code-open' : ''}`} onClick=${() => view.toggle(file)}>
        <td>${file.dir}</td>
        <td class="code-file">${file.name}</td>
        <td>${t(`tests.language.${file.language}`)}</td>
        <td class="code-count">${cases ? String(cases.length) : html`<span class="cell-spin"></span>`}</td>
      </tr>
      ${open && html`
        <tr class="code-cases">
          <td colspan="4">
            ${cases && cases.length
              ? html`<ul>${cases.map(name => html`<li>${name}</li>`)}</ul>`
              : t('tests.code.noCases')}
          </td>
        </tr>
      `}
    `;
  };
  return html`
    <h2>${t('view.testsWith', { view: t(`tests.kind.${view.kind}`) })}</h2>
    <p class="table-note">${view.note}</p>
    <div class="table-scroll">
      ${files && html`
        <table class="table table-sm code-table">
          <thead><tr>
            ${['folder', 'file', 'language', 'cases'].map(column => html`<th>${t(`tests.code.${column}`)}</th>`)}
          </tr></thead>
          <tbody>${files.map(row)}</tbody>
        </table>
      `}
    </div>
  `;
}
