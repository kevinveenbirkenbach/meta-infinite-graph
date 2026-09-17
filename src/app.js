import { AutoResolver } from './autoResolver.js';
import { CommitsView } from './commitsView.js';
import { codeTests, dataLoader, graphRenderer, selectionManager, setStatus, urlState } from './context.js';
import { ForkTree } from './fork/tree.js';
import { GitRange } from './gitRange.js';
import { GitHubApi } from './github/api.js';
import { RunAnnotations } from './github/annotations.js';
import { GitHubFeed } from './github/feed.js';
import { FeedRefresher } from './github/refresh.js';
import { GitHubSecurity } from './github/security.js';
import { GitHubWarnings } from './github/warnings.js';
import { t } from './i18n.js';
import { Loader } from './loader/indicator.js';
import { wireLoaderOverview } from './loader/overview.js';
import { MatrixView } from './matrix/view.js';
import { MetaGraph } from './meta/graph.js';
import { MetaTables } from './meta/tables.js';
import { PlaywrightMatrix } from './playwrightMatrix.js';
import * as popup from './popup.js';
import { RoleCardHost } from './role/cardHost.js';
import { RoleInfo } from './role/info.js';
import { TableView } from './table/view.js';
import { CodeTests } from './tests/code/model.js';
import { CodeTestsView } from './tests/code/view.js';
import { TestRuns } from './tests/runs.js';
import { TestsView } from './tests/view.js';
import { UIManager } from './uiManager.js';
import { UrlState } from './urlState.js';
import { wireDesign } from './wire/design.js';
import { wireForks } from './wire/forks.js';
import { wireGraphCards, wireRoleSelect } from './wire/graph.js';
import { wireControls, wireDataSwitches } from './wire/switches.js';
import { wireReload } from './wire/reload.js';
import { restoreFromUrl } from './wire/url.js';
import { currentView, disableMetaViews, redraw, wirePanels, wireViewMode } from './wire/views.js';

// app.js
//
// Boot: scan the roles tree, parse every meta/*.yml, build the derived
// graph index, then hand over to the UI. Everything after boot is
// in-memory; expanding nodes never refetches.

// The specs reach these through page.evaluate; nothing in the app reads them.
Object.assign(window, { PlaywrightMatrix, RoleInfo, TableView, TestsView, UrlState });

setStatus(t('status.scanning'));

const loader = new Loader(document.getElementById('view-loader'));
wireLoaderOverview(document.getElementById('view-loader'), loader);
wirePanels();
wireDesign(graphRenderer);


const gitRange = new GitRange(urlState, range => {
  // A moved handle changes which commits exist for every view, so the page is
  // rebuilt from the new base path instead of each view being invalidated.
  const params = new URLSearchParams(window.location.search);
  params.set('from', new Date(range.from).toISOString());
  params.set('until', range.head());
  params.set('refs', range.refs.join(','));
  window.location.search = params.toString();
});
window.gitRange = gitRange;

// Before the scan: a right handle in the past means the tables read the roles
// tree of that commit, not the mounted working copy.
loader.track('*', gitRange.load()
  .then(catalog => (catalog ? GitRange.rewind(gitRange.head(), gitRange.treeRef()) : null))
  .then(GitRange.inspect)
  .then(({ rewound, missing }) => {
    if (rewound && !missing.length) {
      dataLoader.basePath = `${rewound.path}roles`;
      dataLoader.metaPath = `${rewound.path}meta`;
      codeTests.base = `${rewound.path}tests`;
      setStatus(t('status.scanningAt', { date: rewound.date.slice(0, 10) }));
    } else if (rewound) {
      gitRange.markMissing(rewound.date, missing);
      disableMetaViews(missing);
    }
    return Promise.all([dataLoader.listRoles(), dataLoader.loadCategories()]);
  })
  .then(([roles, categories]) => {
    setStatus(t('status.loadingMeta', { n: roles.length }));
    return dataLoader
      .loadAll(roles, (done, total) => {
        if (done % 25 === 0 || done === total) {
          setStatus(t('status.loadingProgress', { done, total }));
        }
      })
      .then(metaByRole => [metaByRole, categories]);
  })
  .then(([metaByRole, categories]) => {
    const metaGraph = new MetaGraph(metaByRole);
    const metaTables = new MetaTables(metaByRole, categories);
    const roleInfo = new RoleInfo(dataLoader, metaGraph, metaTables);
    const tableView = new TableView(metaTables, document.getElementById('tables'), roleInfo);
    const cardHost = new RoleCardHost(roleInfo);
    const forkTree = new ForkTree(new GitHubApi(), document.getElementById('tables'), cardHost);
    forkTree.useMirror(gitRange);
    const tables = document.getElementById('tables');
    const matrixView = new MatrixView(
      tableView, dataLoader, tables, () => urlState.capture(), cardHost
    );
    tableView.matrix = matrixView;
    const annotations = new RunAnnotations(forkTree.api);
    const feeds = {
      commits: new CommitsView(gitRange, tables),
      pulls: new GitHubFeed('pulls', forkTree.api, gitRange, tables),
      actions: new GitHubFeed('actions', forkTree.api, gitRange, tables),
      security: new GitHubSecurity(forkTree.api, gitRange, tables),
      warnings: new GitHubWarnings(forkTree.api, gitRange, tables, annotations),
    };
    const codeView = new CodeTestsView(codeTests, annotations, tables);
    const testsView = new TestsView(
      tableView.tables, dataLoader, roleInfo, cardHost, document.getElementById('tables'),
      new TestRuns(forkTree.api, () => (gitRange.catalog ? gitRange.catalog.root : forkTree.root))
    );
    testsView.track = (promise, label) => loader.track('playwright', promise, label);
    codeView.track = (promise, label) => loader.track(currentView(), promise, label);
    feeds.warnings.track = (promise, label) => loader.track('warnings', promise, label);
    testsView.runs.onLoad = (name, promise) => loader.track(null, promise, t('loader.task.artifact', { name }));
    forkTree.api.onFetch = (path, promise) => loader.track(null, promise, t('loader.task.github', { path }));
    const autoResolver = new AutoResolver();
    const uiManager = new UIManager(
      metaGraph, selectionManager, graphRenderer, autoResolver
    );
    const switches = wireDataSwitches(
      tableView, testsView, roleInfo, uiManager, dataLoader, metaGraph.roles
    );

    for (const id of ['facet-author', 'facet-lifecycle', 'facet-mode']) {
      document.getElementById(id).addEventListener('change', () => {
        const filters = uiManager.filters();
        tableView.setFilters(filters);
        testsView.setFilters(filters);
        // Dispatch per view: refreshing the tables unconditionally would
        // replace whatever the forks or tests view had drawn.
        redraw(tableView, testsView);
      });
    }

    wireGraphCards(cardHost);
    const { sel, ranked } = wireRoleSelect(metaGraph);
    uiManager.buildFacetControls();
    sel.value = ranked[0];

    const refresher = new FeedRefresher(feeds.actions, loader, () => currentView() === 'actions');
    const pending = restoreFromUrl({
      sel, ranked, metaGraph, testsView, forkTree, matrixView, roleInfo, tableView, switches, refresher, feeds,
    });
    feeds.actions.onFilter = () => urlState.capture();
    feeds.warnings.onFilter = () => urlState.capture();
    tableView.setFilters(uiManager.filters());
    let drawView = () => {};
    wireControls({ testsView, matrixView, roleInfo, forkTree, onRun: () => drawView() });
    wireForks(forkTree, cardHost);
    // The hook lands last: wireViewMode redraws the active view, so a test that
    // takes __mig as ready any earlier can grab a row the redraw then replaces
    // under its pointer.
    return Promise.all(pending).then(() => {
      drawView = wireViewMode({ tableView, forkTree, testsView, codeView, feeds, loader, refresher });
      wireReload({
        anchor: document.getElementById('view-loader'),
        loader,
        refresher,
        api: forkTree.api,
        onChange: () => urlState.capture(),
        reloads: {
          forks: () => {
            forkTree.invalidate();
            return forkTree.show();
          },
          playwright: () => {
            testsView.invalidate();
            return testsView.show('playwright');
          },
          cli: () => {
            testsView.invalidate();
            return testsView.show('cli');
          },
          commits: () => feeds.commits.show(),
          pulls: () => feeds.pulls.show(true),
          security: () => feeds.security.show(true),
          warnings: () => feeds.warnings.show(true),
          ...Object.fromEntries(CodeTests.KINDS.map(kind => [kind, () => {
            codeView.invalidate();
            return codeView.show(kind);
          }])),
        },
      });
      uiManager.onSelectionChange();
      urlState.capture();
      window.__mig = {
        metaGraph, selectionManager, uiManager, tableView, roleInfo, cardHost, forkTree,
        testsView, codeView, codeTests, annotations, dataLoader, gitRange, feeds, matrixView, popup,
        graph: graphRenderer.graph,
      };
    });
  })
  .catch(err => {
    console.error('Init error', err);
    setStatus(t('status.failed', { message: err.message }));
  }), t('loader.task.boot'));
