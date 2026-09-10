function currentView() {
  return document.querySelector('input[name="view"]:checked').value;
}

// Filling these from the working copy would put today's numbers under a past
// timestamp, so at a date that predates the schema they are greyed instead.
const META_VIEWS = ['graph', 'bond', 'matrix', 'tests'];

function disableMetaViews(missing) {
  const why = `${missing.join(', ')} does not exist at the chosen date. This view reads `
    + 'from it, so it would show the working copy rather than that state.';
  for (const view of META_VIEWS) {
    const input = document.getElementById(`view-${view}`);
    const label = document.querySelector(`label[for="view-${view}"]`);
    input.disabled = true;
    label.classList.add('view-unavailable');
    label.title = why;
  }
  const roles = document.getElementById('btn-roles');
  roles.classList.add('view-unavailable');
  roles.title = why;
  if (META_VIEWS.includes(currentView())) {
    document.getElementById('view-commits').checked = true;
  }
}

function wireViewMode(tableView, forkTree, testsView, feeds) {
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
      element.hidden = tables;
    }
    for (const element of document.querySelectorAll('.forks-only')) {
      element.hidden = view !== 'forks';
    }
    for (const element of document.querySelectorAll('.tests-only')) {
      element.hidden = view !== 'tests';
    }
    const roles = document.getElementById('btn-roles');
    const sub = document.querySelector(`label[for="view-${view}"].dropdown-item`);
    roles.classList.toggle('active', Boolean(sub));
    roles.textContent = sub ? `Roles · ${sub.textContent}` : 'Roles';
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
function redraw(tableView, testsView) {
  const view = currentView();
  if (view === 'tests') testsView.refresh();
  else if (!['graph', 'forks', 'commits', 'pulls', 'actions'].includes(view)) tableView.refresh();
}

function wirePanels() {
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
