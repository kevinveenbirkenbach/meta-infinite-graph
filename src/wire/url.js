import { facet, setFacet, urlState } from '../context.js';
import { byId } from '../dom.js';
import { MatrixModel } from '../matrix/model.js';
import { currentView } from './views.js';

const EDGE_IDS = [
  'edge-role-deps', 'edge-role-dependents', 'edge-dependencies',
  'edge-dependents', 'edge-run-after', 'edge-visible',
];

function checkedEdges() {
  return EDGE_IDS
    .filter(id => byId(id, HTMLInputElement).checked)
    .map(id => id.slice(5))
    .join(',');
}

function registerMatrixUrl(matrixView) {
  urlState
    .register('cols', () => matrixView.columns.join(','), value => {
      matrixView.columns = ['role', ...value.split(',').filter(id => id && id !== 'role')];
    }, MatrixModel.DEFAULT.join(','))
    .register('order', () => matrixView.sort.map(key => `${key.id}:${key.dir}`).join(','), value => {
      matrixView.sort = value.split(',').filter(Boolean).map(entry => {
        const cut = entry.lastIndexOf(':');
        return { id: entry.slice(0, cut), dir: entry.slice(cut + 1) === 'desc' ? 'desc' : 'asc' };
      });
    }, 'role:asc')
    .register('complexity', () => String(matrixView.complexity), value => {
      matrixView.complexity = value === 'true';
    }, 'false')
    .register('find', () => matrixView.find, value => {
      matrixView.find = value;
    }, '')
    .register('density', () => matrixView.density, value => {
      matrixView.density = value === 'comfort' ? 'comfort' : 'compact';
    }, 'compact');
}

const WARNING_KEYS = { search: 'warn', level: 'warnlevel', job: 'warnjob', repository: 'warnrepo' };

// Returns: the promises of the switches the URL turned on, which have to
// settle before the first view is drawn.
export function restoreFromUrl({
  sel, ranked, metaGraph, testsView, forkTree, matrixView, roleInfo, tableView, switches, refresher, feeds,
}) {
  for (const name of Object.keys(feeds.actions.filters)) {
    urlState.register(name, () => feeds.actions.filters[name], value => {
      feeds.actions.filters[name] = value;
    }, '');
  }
  // The warnings tab filters by the same words the actions feed does, so its
  // keys carry a prefix rather than overwriting the feed's.
  for (const [name, key] of Object.entries(WARNING_KEYS)) {
    urlState.register(key, () => feeds.warnings.filters[name], value => {
      feeds.warnings.filters[name] = value;
    }, '');
  }
  const pending = [];
  const edgeDefault = checkedEdges();
  urlState
    .register('view', currentView, value => {
      const input = document.getElementById(`view-${value === 'tests' ? 'playwright' : value}`);
      if (input instanceof HTMLInputElement) input.checked = true;
    }, 'graph')
    .register('role', () => sel.value, value => {
      if (metaGraph.roles.includes(value)) sel.value = value;
    }, ranked[0])
    .register('sort', () => testsView.sort, value => testsView.setSort(value), 'name')
    .register('branches', () => String(forkTree.branches), value => {
      forkTree.branches = value === 'true';
      byId('design-branches', HTMLInputElement).checked = forkTree.branches;
    }, 'true');
  registerMatrixUrl(matrixView);
  urlState
    .register('resources', () => String(roleInfo.resources), value => {
      roleInfo.resources = value === 'true';
      byId('design-resources', HTMLInputElement).checked = roleInfo.resources;
    }, 'true')
    .register('tags', () => String(forkTree.tags), value => {
      forkTree.tags = value === 'true';
      byId('design-tags', HTMLInputElement).checked = forkTree.tags;
    }, 'false')
    .register('gate', () => testsView.gate, value => testsView.setGate(value), 'all')
    .register('refresh', () => String(refresher.seconds), value => refresher.setSeconds(Number(value)), '60')
    .register('run', () => testsView.runs.key(), value => {
      if (/^([\w.-]+\/[\w.-]+@)?\d+$/.test(value)) testsView.pickRun(value);
    }, '')
    .register('repo', () => forkTree.root, value => {
      forkTree.setRoot(value);
      byId('fork-root', HTMLInputElement).value = forkTree.root;
    }, forkTree.root)
    .register('author', () => facet('facet-author'), value => setFacet('facet-author', value), '')
    .register('lifecycle', () => facet('facet-lifecycle'), value => setFacet('facet-lifecycle', value), '')
    .register('mode', () => facet('facet-mode'), value => setFacet('facet-mode', value), '')
    .register('edges', checkedEdges, value => {
      const wanted = value ? value.split(',') : [];
      for (const id of EDGE_IDS) {
        byId(id, HTMLInputElement).checked = wanted.includes(id.slice(5));
      }
    }, edgeDefault)
    .register('variants', () => String(tableView.variantAware), value => {
      if (value === 'true') pending.push(switches.setVariants(true));
    }, 'false')
    .register('symbols', () => String(roleInfo.symbols), value => {
      if (value === 'true') pending.push(switches.setSymbols(true));
    }, 'false');

  urlState.apply();
  for (const id of [...EDGE_IDS, 'facet-author', 'facet-lifecycle', 'facet-mode', 'sel-role']) {
    document.getElementById(id).addEventListener('change', () => urlState.capture());
  }
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener('change', () => urlState.capture());
  }
  return pending;
}
