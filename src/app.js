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

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return { role: p.get('role') || '' };
}

function currentView() {
  return document.querySelector('input[name="view"]:checked').value;
}

function setStatus(text) {
  document.getElementById('status').innerText = text;
}

setStatus('Scanning roles ...');

wirePanels();
wireDesign();

function wireViewMode(tableView) {
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
    if (tables) tableView.show(view);
  };
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.addEventListener('change', apply);
  }
  apply();
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

function wireDesign() {
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
  const store = (key, value) => {
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

  const applySize = () => {
    root.style.setProperty('--mig-font-size', `${size.value}px`);
    document.getElementById('design-font-size-value').textContent = size.value;
    store('mig-font-size', size.value);
  };
  const applyFamily = () => {
    root.style.setProperty('--mig-font-family', families[family.value]);
    store('mig-font-family', family.value);
  };
  const applyVeil = () => {
    root.style.setProperty('--mig-veil', String(veil.value / 100));
    document.getElementById('design-opacity-value').textContent = veil.value;
    store('mig-veil', veil.value);
  };

  size.value = read('mig-font-size') || size.value;
  family.value = read('mig-font-family') || family.value;
  veil.value = read('mig-veil') ?? veil.value;
  theme.value = read('mig-theme') || 'system';

  size.addEventListener('input', applySize);
  family.addEventListener('change', applyFamily);
  veil.addEventListener('input', applyVeil);
  theme.addEventListener('change', () => window.MigTheme.choose(theme.value));

  applySize();
  applyFamily();
  applyVeil();
}

function wireDataSwitches(tableView, roleInfo, uiManager, dataLoader, roles) {
  const variantButton = document.getElementById('btn-variants');
  const symbolButton = document.getElementById('btn-symbols');
  let variantsLoaded = false;

  variantButton.addEventListener('click', () => {
    const next = !tableView.variantAware;
    const start = variantsLoaded
      ? Promise.resolve()
      : dataLoader.loadSideFileAll(roles, 'variants').then(raw => {
        tableView.tables.setVariants(raw);
        uiManager.setVariants(raw);
        variantsLoaded = true;
      });
    variantButton.disabled = true;
    start.then(() => {
      tableView.variantAware = next;
      uiManager.setVariantAware(next);
      variantButton.classList.toggle('active', next);
      variantButton.title = `Variant aware: ${next ? 'on' : 'off'}`;
      variantButton.disabled = false;
      tableView.refresh();
    });
  });

  symbolButton.addEventListener('click', () => {
    symbolButton.disabled = true;
    roleInfo.load().then(() => {
      roleInfo.symbols = !roleInfo.symbols;
      symbolButton.textContent = roleInfo.symbols ? '🔡' : '🔤';
      symbolButton.title = roleInfo.symbols
        ? 'Show role names as symbols'
        : 'Show role names as text';
      symbolButton.disabled = false;
      tableView.refresh();
    });
  });
}

Promise.all([dataLoader.listRoles(), dataLoader.loadCategories()])
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
    wireViewMode(tableView);
    const autoResolver = new AutoResolver();
    const uiManager = new UIManager(
      metaGraph, selectionManager, graphRenderer, autoResolver
    );
    wireDataSwitches(tableView, roleInfo, uiManager, dataLoader, metaGraph.roles);

    for (const id of ['facet-author', 'facet-lifecycle', 'facet-mode']) {
      document.getElementById(id).addEventListener('change', () => {
        tableView.setFilters(uiManager.filters());
        if (currentView() !== 'graph') tableView.refresh();
      });
    }

    const cardHost = new RoleCardHost(roleInfo);
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
    tableView.setFilters(uiManager.filters());

    const { role } = getParams();
    sel.value = role && metaGraph.roles.includes(role) ? role : ranked[0];
    uiManager.onSelectionChange();

    // Test hook for the Playwright suite.
    window.__mig = {
      metaGraph, selectionManager, uiManager, tableView, roleInfo, cardHost,
      graph: graphRenderer.graph,
    };
  })
  .catch(err => {
    console.error('Init error', err);
    setStatus('Initialization failed: ' + err.message);
  });
