import { byId, bySelector } from '../dom.js';
import { t } from '../i18n.js';
import { CodeTests } from '../tests/code/model.js';

export function currentView() {
  return bySelector('input[name="view"]:checked', HTMLInputElement).value;
}

// Returns: the view's name as its menu entry reads, in the page's language.
export function viewName(view) {
  const label = document.querySelector(`label[for="view-${view}"]`);
  return label ? label.textContent : view;
}

export const TEST_VIEWS = ['playwright', 'cli'];

export const CODE_VIEWS = CodeTests.KINDS;

// Filling these from the working copy would put today's numbers under a past
// timestamp, so at a date that predates the schema they are greyed instead.
const META_VIEWS = ['graph', 'bond', 'matrix', ...TEST_VIEWS];

// button id -> [the key naming its menu, the key naming it with the pick].
const MENUS = {
  'btn-roles': ['view.roles', 'view.rolesWith'],
  'btn-tests': ['view.tests', 'view.testsWith'],
  'btn-items': ['view.items', 'view.itemsWith'],
  'btn-security': ['view.security', 'view.securityWith'],
};

export function disableMetaViews(missing) {
  const why = t('views.missing', { files: missing.join(', ') });
  for (const view of META_VIEWS) {
    const input = byId(`view-${view}`, HTMLInputElement);
    const label = bySelector(`label[for="view-${view}"]`, HTMLLabelElement);
    input.disabled = true;
    label.classList.add('view-unavailable');
    label.title = why;
  }
  for (const id of Object.keys(MENUS)) {
    const button = byId(id, HTMLButtonElement);
    button.classList.add('view-unavailable');
    button.title = why;
  }
  if (META_VIEWS.includes(currentView())) {
    byId('view-commits', HTMLInputElement).checked = true;
  }
}

// Args:
//   loader: the bottom bar's Loader, told which view is on screen and what it waits for.
//   refresher: the FeedRefresher of the actions feed.
//   codeView: the CodeTestsView drawing the repository's own suites.
// Returns: the function that draws the view on screen again.
export function wireViewMode({ tableView, forkTree, testsView, codeView, feeds, loader, refresher }) {
  const pane = document.getElementById('tables-pane');
  const graph = document.getElementById('graph3d');
  const open = view => {
    const input = byId(`view-${view}`, HTMLInputElement);
    input.checked = true;
    input.dispatchEvent(new Event('change'));
  };
  feeds.actions.onPick = (run, view = 'playwright') => {
    testsView.pickRun(testsView.runs.keyOf(run), run);
    open(view);
  };
  const apply = () => {
    const view = currentView();
    loader.show(view);
    // Whatever picked the run - a click, the URL, the menu - every view that
    // draws one holds the same one.
    codeView.pick(testsView.runs.repo, testsView.runs.run);
    feeds.warnings.pin(testsView.runs.repo, testsView.runs.run);
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
      element.toggleAttribute('hidden', !TEST_VIEWS.includes(view));
    }
    for (const [id, [plain, picked]] of Object.entries(MENUS)) {
      const button = byId(id, HTMLButtonElement);
      const sub = button.parentElement.querySelector(`label[for="view-${view}"].dropdown-item`);
      button.classList.toggle('active', Boolean(sub));
      button.textContent = sub ? t(picked, { view: sub.textContent }) : t(plain);
    }
    const drawing = t('loader.task.view', { view: viewName(view) });
    if (view === 'forks') loader.track(view, forkTree.show(), drawing);
    else if (TEST_VIEWS.includes(view)) loader.track(view, testsView.show(view), drawing);
    else if (CODE_VIEWS.includes(view)) loader.track(view, codeView.show(view), drawing);
    else if (feeds[view]) loader.track(view, feeds[view].show(), drawing);
    else if (tables) loader.track(view, tableView.show(view), drawing);
    refresher.restart();
  };
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener('change', apply);
  }
  apply();
  return apply;
}

// Both switches feed both views, so the redraw has to follow the visible one
// rather than always refreshing the tables over whatever is on screen.
export function redraw(tableView, testsView) {
  const view = currentView();
  if (TEST_VIEWS.includes(view)) testsView.refresh();
  else if (!['graph', 'forks', 'commits', 'pulls', 'actions', 'security', 'warnings', ...CODE_VIEWS].includes(view)) {
    tableView.refresh();
  }
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
