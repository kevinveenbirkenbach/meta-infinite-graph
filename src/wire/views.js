import { byId, bySelector } from '../dom.js';
import { t } from '../i18n.js';

export function currentView() {
  return bySelector('input[name="view"]:checked', HTMLInputElement).value;
}

// Filling these from the working copy would put today's numbers under a past
// timestamp, so at a date that predates the schema they are greyed instead.
const META_VIEWS = ['graph', 'bond', 'matrix', 'tests'];

export function disableMetaViews(missing) {
  const why = t('views.missing', { files: missing.join(', ') });
  for (const view of META_VIEWS) {
    const input = byId(`view-${view}`, HTMLInputElement);
    const label = bySelector(`label[for="view-${view}"]`, HTMLLabelElement);
    input.disabled = true;
    label.classList.add('view-unavailable');
    label.title = why;
  }
  const roles = byId('btn-roles', HTMLButtonElement);
  roles.classList.add('view-unavailable');
  roles.title = why;
  if (META_VIEWS.includes(currentView())) {
    byId('view-commits', HTMLInputElement).checked = true;
  }
}

export function wireViewMode(tableView, forkTree, testsView, feeds) {
  const pane = document.getElementById('tables-pane');
  const graph = document.getElementById('graph3d');
  const apply = () => {
    const view = currentView();
    const tables = view !== 'graph';
    pane.classList.toggle('pane-front', tables);
    pane.classList.toggle('pane-back', !tables);
    graph.classList.toggle('pane-front', !tables);
    graph.classList.toggle('pane-back', tables);
    for (const element of document.querySelectorAll('.graph-only')) {
      element.toggleAttribute('hidden', tables);
    }
    for (const element of document.querySelectorAll('.forks-only')) {
      element.toggleAttribute('hidden', view !== 'forks');
    }
    for (const element of document.querySelectorAll('.tests-only')) {
      element.toggleAttribute('hidden', view !== 'tests');
    }
    const roles = byId('btn-roles', HTMLButtonElement);
    const sub = document.querySelector(`label[for="view-${view}"].dropdown-item`);
    roles.classList.toggle('active', Boolean(sub));
    roles.textContent = sub ? t('view.rolesWith', { view: sub.textContent }) : t('view.roles');
    if (view === 'forks') forkTree.show();
    else if (view === 'tests') testsView.show();
    else if (feeds[view]) feeds[view].show();
    else if (tables) tableView.show(view);
  };
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener('change', apply);
  }
  apply();
}

// Both switches feed both views, so the redraw has to follow the visible one
// rather than always refreshing the tables over whatever is on screen.
export function redraw(tableView, testsView) {
  const view = currentView();
  if (view === 'tests') testsView.refresh();
  else if (!['graph', 'forks', 'commits', 'pulls', 'actions', 'security'].includes(view)) tableView.refresh();
}

export function wirePanels() {
  const panels = {
    'btn-filter': document.getElementById('sidebar'),
    'btn-design': document.getElementById('design-panel'),
  };
  for (const [id, panel] of Object.entries(panels)) {
    document.getElementById(id).addEventListener('click', () => {
      const opening = panel.hidden;
      for (const other of Object.values(panels)) other.hidden = true;
      panel.hidden = !opening;
      for (const [otherId, other] of Object.entries(panels)) {
        document.getElementById(otherId).classList.toggle('active', !other.hidden);
      }
    });
  }
}
