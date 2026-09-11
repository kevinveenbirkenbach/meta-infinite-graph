import { html, render } from '../html.js';
import { t } from '../i18n.js';
import { viewIn } from './viewer.js';

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Args:
//   kind: 'video' or 'report', how the popup shows the file.
//   title: what the popup calls it.
const link = (id, path, label, kind, title) => {
  const url = `/artifacts/${id}/${path}`;
  return html`<a href=${url} target="_blank" rel="noreferrer" onClick=${viewIn(url, kind, title)}>${label}</a>`;
};

export function RunPicker({ view }) {
  const runs = view.runs.runs || [];
  const current = view.runs.run;
  const same = run => Boolean(current) && run.id === current.id;
  const listed = current && !runs.some(same) ? [current, ...runs] : runs.map(run => (same(run) ? current : run));
  return html`
    <label class="tests-run">
      ${t('tests.run.label')}
      <select class="form-select form-select-sm" onChange=${event => view.pickRun(event.currentTarget.value)}>
        <option value="">${t('tests.run.none')}</option>
        ${listed.map(run => html`
          <option value=${run === current ? view.runs.key() : run.id} selected=${run === current}>
            ${[`#${run.run_number}`, run.display_title, run.head_branch, (run.created_at || '').slice(0, 10), run.conclusion]
              .filter(Boolean).join(' · ')}
          </option>
        `)}
      </select>
    </label>
  `;
}

const MARK = { passed: '✓', failed: '✗', skipped: '–', missing: '·', error: '!' };

// Args (props):
//   runs: TestRuns with a run picked and the cell's line carried by it.
//   row: the cell's test row.
//   cell: the key the hover card finds the row by.
export function RunMark({ runs, row, cell }) {
  const outcome = runs.outcome(row);
  const failure = runs.of(row.role, row.variant)
    .map(artifact => runs.unpacked.get(artifact.id))
    .find(entry => entry && entry.state === 'error');
  const title = {
    loading: () => t('tests.card.loadingArtifact'),
    missing: () => t('tests.card.notInArtifact'),
    error: () => t('tests.card.artifactFailed', { message: failure ? failure.error.message : '' }),
  }[outcome] || (() => t(`tests.result.${outcome}`));
  return html`<td class=${`run-cell run-${outcome}`} data-cell=${cell} title=${title()}>
    ${outcome === 'loading' ? html`<span class="cell-spin" aria-hidden="true"></span>` : MARK[outcome]}
  </td>`;
}

export function RunCell({ artifacts }) {
  return html`<th class="tests-axis tests-ran" title=${artifacts.map(artifact => artifact.name).join('\n')}>
    ${artifacts.length ? '▶' : ''}
  </th>`;
}

// Returns: the videos of one test, from its JUnit attachments or, when the
//   reporter recorded none, from the failed test's own test-results folder.
function videos(report, test, title) {
  const attached = test.attachments.filter(path => path.endsWith('.webm'));
  if (attached.length || test.status !== 'failed') return attached;
  const wanted = slug(title).slice(0, 30);
  return report.videos.filter(path => slug(path).includes(wanted));
}

function Outcome({ artifact, answer, error }, row) {
  const label = [artifact.mode, artifact.distro, artifact.filesystem].filter(Boolean).join(' · ');
  if (error) return html`<dd class="fork-error">${label}: ${t('tests.card.artifactFailed', { message: error.message })}</dd>`;
  const reports = answer.reports.filter(report => report.app === row.role
    && (row.variant === null || report.variant === row.variant));
  if (!reports.length) return html`<dd>${label}: ${t('tests.card.notInArtifact')}</dd>`;
  return reports.map(report => {
    const where = `${label} · ${report.phase}`;
    const test = report.tests.find(one => one.name === row.test || one.name.endsWith(` › ${row.test}`));
    if (!test) return html`<dd>${where}: ${t('tests.card.notInArtifact')}</dd>`;
    return html`<dd class="test-outcome">
      <span class=${`test-result test-result-${test.status}`}>${t(`tests.result.${test.status}`)}</span>
      ${` ${where}`}
      ${test.message && html`<div class="test-message">${test.message}</div>`}
      <div class="role-card-links">
        ${videos(report, test, row.test).map(path => link(artifact.id, path, t('tests.card.video'), 'video',
          `${row.test} · ${where}`))}
        ${report.report && link(artifact.id, report.report, t('tests.card.report'), 'report', `${row.role} · ${where}`)}
      </div>
    </dd>`;
  });
}

// Args:
//   box: the element the card keeps for this section.
//   runs: TestRuns with a run picked.
//   row: the hovered test row.
export function fillRun(box, runs, row) {
  const title = html`<dt>${t('tests.card.run', { number: runs.run.run_number })}</dt>`;
  const artifacts = runs.of(row.role, row.variant);
  if (!artifacts.length) {
    render(html`${title}<dd>${t('tests.run.absent')}</dd>`, box);
    return;
  }
  render(html`${title}<dd>${t('tests.card.loadingArtifact')}</dd>`, box);
  Promise.all(artifacts.map(artifact => runs.load(artifact.id).then(
    answer => ({ artifact, answer }),
    error => ({ artifact, error })
  ))).then(found => render(html`${title}${found.map(entry => Outcome(entry, row))}`, box));
}
