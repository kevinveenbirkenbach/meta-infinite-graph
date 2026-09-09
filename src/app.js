// app.js
//
// Boot: scan the roles tree, parse every meta/*.yml, build the derived
// graph index, then hand over to the UI. Everything after boot is
// in-memory; expanding nodes never refetches.

window.addEventListener('error', e => {
  const el = document.getElementById('status');
  if (el) el.innerText = 'JS error: ' + (e.message || e.error);
});

const dataLoader = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer = new GraphRenderer('graph3d', selectionManager);

const urlState = new UrlState();
window.urlState = urlState;

function facet(id) {
  return document.getElementById(id).value;
}

function setFacet(id, value) {
  const select = document.getElementById(id);
  if ([...select.options].some(option => option.value === value)) select.value = value;
}

function setStatus(text) {
  document.getElementById('status').innerText = text;
}

setStatus('Scanning roles ...');

wirePanels();
wireDesign(graphRenderer);

function currentView() {
  return document.querySelector('input[name="view"]:checked').value;
}

// Filling these from the working copy would put today's numbers under a past
// timestamp, so at a date that predates the schema they are greyed instead.
const META_VIEWS = ['graph', 'bond', 'ressources', 'complexity', 'tests'];

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
  if (META_VIEWS.includes(currentView())) {
    document.getElementById('view-forks').checked = true;
  }
}

function wireViewMode(tableView, forkTree, testsView) {
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
    if (view === 'forks') forkTree.show();
    else if (view === 'tests') testsView.show();
    else if (tables) tableView.show(view);
  };
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener('change', apply);
  }
  apply();
}

function wireForks(forkTree, cardHost) {
  const root = document.getElementById('fork-root');
  const token = document.getElementById('fork-token');
  const forget = document.getElementById('fork-forget');
  const owned = document.getElementById('fork-token-owned');
  const field = document.querySelector('.token-field');

  // Left of the panel rather than at the pointer: the panel is the right edge
  // of the window, so a card at the pointer covers the very input to fill in.
  const help = () => {
    const box = field.getBoundingClientRect();
    cardHost.show(
      ForkTree.TOKEN_HELP,
      { x: box.left, y: box.top, flip: true },
      ForkTree.tokenHelp
    );
  };
  field.addEventListener('mouseover', help);
  field.addEventListener('focusin', help);
  field.addEventListener('mouseout', () => cardHost.release(ForkTree.TOKEN_HELP));
  field.addEventListener('focusout', () => cardHost.release(ForkTree.TOKEN_HELP));

  root.value = forkTree.root;
  token.value = forkTree.api.token;

  forkTree.api.detectProxy().then(proxied => {
    for (const element of document.querySelectorAll('.token-field')) {
      element.hidden = proxied;
    }
    owned.hidden = !proxied;
    if (proxied) {
      forkTree.api.token = '';
      token.value = '';
    }
  });

  root.addEventListener('change', () => {
    if (!ForkTree.isRepo(root.value.trim())) {
      root.value = forkTree.root;
      return;
    }
    forkTree.setRoot(root.value.trim());
    urlState.capture();
    if (currentView() === 'forks') forkTree.show();
  });

  token.addEventListener('change', () => {
    forkTree.api.token = token.value.trim();
    forkTree.loaded = null;
    if (currentView() === 'forks') forkTree.show();
  });

  forget.addEventListener('click', () => {
    forkTree.api.forget();
    forkTree.api.token = '';
    token.value = '';
    forkTree.loaded = null;
    if (currentView() === 'forks') forkTree.show();
  });
}

// Both switches feed both views, so the redraw has to follow the visible one
// rather than always refreshing the tables over whatever is on screen.
function redraw(tableView, testsView) {
  const view = currentView();
  if (view === 'tests') testsView.refresh();
  else if (!['graph', 'forks'].includes(view)) tableView.refresh();
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

function wireDesign(graphRenderer) {
  const root = document.documentElement;
  const families = {
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
  const read = key => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A blocked store only costs the choice its persistence.
    }
  };

  const size = document.getElementById('design-font-size');
  const family = document.getElementById('design-font-family');
  const veil = document.getElementById('design-opacity');
  const theme = document.getElementById('design-theme');
  const zoom = document.getElementById('design-zoom');

  const applySize = () => {
    root.style.setProperty('--mig-font-size', `${size.value}px`);
    document.getElementById('design-font-size-value').textContent = size.value;
    write('mig-font-size', size.value);
  };
  const applyFamily = () => {
    root.style.setProperty('--mig-font-family', families[family.value]);
    write('mig-font-family', family.value);
  };
  const applyZoom = () => {
    root.style.setProperty('--mig-zoom', String(zoom.value / 100));
    document.getElementById('design-zoom-value').textContent = zoom.value;
    write('mig-zoom', zoom.value);
    if (graphRenderer) graphRenderer.setZoom(Number(zoom.value));
  };
  const applyVeil = () => {
    root.style.setProperty('--mig-veil', String(veil.value / 100));
    document.getElementById('design-opacity-value').textContent = veil.value;
    write('mig-veil', veil.value);
  };

  size.value = read('mig-font-size') || size.value;
  family.value = read('mig-font-family') || family.value;
  veil.value = read('mig-veil') ?? veil.value;
  zoom.value = read('mig-zoom') || zoom.value;
  theme.value = read('mig-theme') || 'system';

  urlState
    .register('theme', () => theme.value, value => {
      theme.value = value;
      window.MigTheme.choose(value);
    }, 'system')
    .register('fontsize', () => size.value, value => {
      size.value = value;
      applySize();
    }, '14')
    .register('font', () => family.value, value => {
      family.value = value;
      applyFamily();
    }, 'sans')
    .register('veil', () => veil.value, value => {
      veil.value = value;
      applyVeil();
    }, '5')
    .register('zoom', () => zoom.value, value => {
      zoom.value = value;
      applyZoom();
    }, '100');

  const remember = handler => () => {
    handler();
    urlState.capture();
  };
  size.addEventListener('input', remember(applySize));
  family.addEventListener('change', remember(applyFamily));
  veil.addEventListener('input', remember(applyVeil));
  zoom.addEventListener('input', remember(applyZoom));
  theme.addEventListener('change', remember(() => window.MigTheme.choose(theme.value)));

  applySize();
  applyFamily();
  applyVeil();
  applyZoom();
  urlState.apply(['theme', 'fontsize', 'font', 'veil', 'zoom']);
}

function wireDataSwitches(tableView, testsView, roleInfo, uiManager, dataLoader, roles) {
  const variantButton = document.getElementById('btn-variants');
  const symbolButton = document.getElementById('btn-symbols');
  let variantsLoaded = false;

  const setVariants = next => {
    const start = variantsLoaded
      ? Promise.resolve()
      : dataLoader.loadSideFileAll(roles, 'variants').then(raw => {
        tableView.tables.setVariants(raw);
        uiManager.setVariants(raw);
        variantsLoaded = true;
      });
    variantButton.disabled = true;
    return start.then(() => {
      tableView.variantAware = next;
      uiManager.setVariantAware(next);
      variantButton.classList.toggle('active', next);
      variantButton.title = `Variant aware: ${next ? 'on' : 'off'}`;
      variantButton.disabled = false;
      testsView.variantAware = next;
      redraw(tableView, testsView);
    });
  };

  const setSymbols = next => {
    symbolButton.disabled = true;
    return roleInfo.load().then(() => {
      roleInfo.symbols = next;
      symbolButton.textContent = next ? '🔡 Symbols' : '🔤 Text';
      symbolButton.title = next
        ? 'Show role names as symbols'
        : 'Show role names as text';
      symbolButton.classList.toggle('active', next);
      symbolButton.disabled = false;
      redraw(tableView, testsView);
    });
  };

  variantButton.addEventListener('click', () =>
    setVariants(!tableView.variantAware).then(() => urlState.capture()));
  symbolButton.addEventListener('click', () =>
    setSymbols(!roleInfo.symbols).then(() => urlState.capture()));
  return { setVariants, setSymbols };
}

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
gitRange.load()
  .then(catalog => (catalog ? GitRange.rewind(gitRange.head(), gitRange.treeRef()) : null))
  .then(GitRange.inspect)
  .then(({ rewound, missing }) => {
    if (rewound && !missing.length) {
      dataLoader.basePath = `${rewound.path}roles`;
      dataLoader.metaPath = `${rewound.path}meta`;
      setStatus(`Scanning roles at ${rewound.date.slice(0, 10)} ...`);
    } else if (rewound) {
      gitRange.markMissing(rewound.date, missing);
      disableMetaViews(missing);
    }
    return Promise.all([dataLoader.listRoles(), dataLoader.loadCategories()]);
  })
  .then(([roles, categories]) => {
    setStatus(`Loading meta of ${roles.length} roles ...`);
    return dataLoader
      .loadAll(roles, (done, total) => {
        if (done % 25 === 0 || done === total) {
          setStatus(`Loading meta ${done}/${total} ...`);
        }
      })
      .then(metaByRole => [metaByRole, categories]);
  })
  .then(([metaByRole, categories]) => {
    const metaGraph = new MetaGraph(metaByRole);
    const roleInfo = new RoleInfo(dataLoader, metaGraph);
    const tableView = new TableView(
      new MetaTables(metaByRole, categories),
      document.getElementById('tables'),
      roleInfo
    );
    const cardHost = new RoleCardHost(roleInfo);
    const forkTree = new ForkTree(new GitHubApi(), document.getElementById('tables'), cardHost);
    forkTree.useMirror(gitRange);
    const testsView = new TestsView(
      tableView.tables, dataLoader, roleInfo, cardHost, document.getElementById('tables')
    );
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

    cardHost.bind(document.getElementById('tables'));
    graphRenderer.on('nodeClicked', ({ node }) => {
      cardHost.pin(node.id, () => {
        const point = graphRenderer.graph.graph2ScreenCoords(node.x, node.y, node.z);
        return point ? { x: point.x, y: point.y } : null;
      });
    });
    graphRenderer.on('backgroundClicked', () => cardHost.unpin());
    let hoveredNode = null;
    graphRenderer.on('nodeHovered', ({ node }) => {
      if (hoveredNode && hoveredNode !== node?.id) cardHost.release(hoveredNode);
      hoveredNode = node ? node.id : null;
      if (!node) return;
      const point = graphRenderer.graph.graph2ScreenCoords(node.x, node.y, node.z);
      cardHost.show(node.id, point ? { x: point.x, y: point.y } : { x: 20, y: 80 });
    });

    // Heaviest role first, so the dropdown and the default start node both
    // open on the busiest hub of the graph.
    const ranked = metaGraph.rolesByWeight();
    const sel = document.getElementById('sel-role');
    const fill = list => {
      sel.innerHTML = '';
      list.forEach(r => {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = `${r} (${metaGraph.weight(r)})`;
        sel.appendChild(o);
      });
    };
    fill(ranked);

    document.getElementById('role-search').addEventListener('input', e => {
      const filter = e.target.value.toLowerCase();
      fill(ranked.filter(r => r.toLowerCase().includes(filter)));
    });

    uiManager.buildFacetControls();
    sel.value = ranked[0];

    const edgeIds = [
      'edge-role-deps', 'edge-role-dependents', 'edge-dependencies',
      'edge-dependents', 'edge-run-after', 'edge-visible',
    ];
    const edgeDefault = edgeIds
      .filter(id => document.getElementById(id).checked)
      .map(id => id.slice(5))
      .join(',');

    urlState
      .register('view', currentView, value => {
        const input = document.getElementById(`view-${value}`);
        if (input) input.checked = true;
      }, 'graph')
      .register('role', () => sel.value, value => {
        if (metaGraph.roles.includes(value)) sel.value = value;
      }, ranked[0])
      .register('sort', () => testsView.sort, value => testsView.setSort(value), 'name')
      .register('branches', () => String(forkTree.branches), value => {
        forkTree.branches = value === 'true';
        document.getElementById('design-branches').checked = forkTree.branches;
      }, 'true')
      .register('tags', () => String(forkTree.tags), value => {
        forkTree.tags = value === 'true';
        document.getElementById('design-tags').checked = forkTree.tags;
      }, 'false')
      .register('kind', () => testsView.kind, value => testsView.setKind(value), 'playwright')
      .register('gate', () => testsView.gate, value => testsView.setGate(value), 'all')
      .register('repo', () => forkTree.root, value => {
        forkTree.setRoot(value);
        document.getElementById('fork-root').value = forkTree.root;
      }, forkTree.root)
      .register('author', () => facet('facet-author'), value => setFacet('facet-author', value), '')
      .register('lifecycle', () => facet('facet-lifecycle'), value => setFacet('facet-lifecycle', value), '')
      .register('mode', () => facet('facet-mode'), value => setFacet('facet-mode', value), '')
      .register('edges', () => edgeIds
        .filter(id => document.getElementById(id).checked)
        .map(id => id.slice(5))
        .join(','), value => {
        const wanted = value ? value.split(',') : [];
        for (const id of edgeIds) {
          document.getElementById(id).checked = wanted.includes(id.slice(5));
        }
      }, edgeDefault)
      .register('variants', () => String(tableView.variantAware), value => {
        if (value === 'true') pending.push(switches.setVariants(true));
      }, 'false')
      .register('symbols', () => String(roleInfo.symbols), value => {
        if (value === 'true') pending.push(switches.setSymbols(true));
      }, 'false');

    const pending = [];
    urlState.apply();
    for (const id of [...edgeIds, 'facet-author', 'facet-lifecycle', 'facet-mode', 'sel-role']) {
      document.getElementById(id).addEventListener('change', () => urlState.capture());
    }
    for (const input of document.querySelectorAll('input[name="view"]')) {
      input.addEventListener('change', () => urlState.capture());
    }

    tableView.setFilters(uiManager.filters());
    testsView.onChange = () => urlState.capture();
    for (const [id, apply] of [
      ['tests-sort', value => testsView.setSort(value)],
      ['tests-gate', value => testsView.setGate(value)],
    ]) {
      document.getElementById(id).addEventListener('change', event => {
        apply(event.target.value);
        urlState.capture();
      });
    }
    for (const [id, apply] of [
      ['design-branches', next => forkTree.setBranches(next)],
      ['design-tags', next => forkTree.setTags(next)],
    ]) {
      const box = document.getElementById(id);
      box.addEventListener('change', () => apply(box.checked).then(() => urlState.capture()));
    }
    wireForks(forkTree, cardHost);
    // The hook lands last: wireViewMode redraws the active view, so a test that
    // takes __mig as ready any earlier can grab a row the redraw then replaces
    // under its pointer.
    return Promise.all(pending).then(() => {
      wireViewMode(tableView, forkTree, testsView);
      uiManager.onSelectionChange();
      urlState.capture();
      window.__mig = {
        metaGraph, selectionManager, uiManager, tableView, roleInfo, cardHost, forkTree,
        testsView, dataLoader, gitRange,
        graph: graphRenderer.graph,
      };
    });
  })
  .catch(err => {
    console.error('Init error', err);
    setStatus('Initialization failed: ' + err.message);
  });
