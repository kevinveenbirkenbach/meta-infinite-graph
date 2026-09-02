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

function setStatus(text) {
  document.getElementById('status').innerText = text;
}

setStatus('Scanning roles ...');

function wireViewMode(tableView) {
  const pane = document.getElementById('tables-pane');
  const graph = document.getElementById('graph3d');
  const sidebar = document.getElementById('sidebar');
  const apply = () => {
    const tables = document.getElementById('mode-2d').checked;
    pane.hidden = !tables;
    graph.hidden = tables;
    sidebar.hidden = tables;
    if (tables) tableView.show(document.querySelector('input[name="table-kind"]:checked').value);
  };
  document.getElementById('mode-3d').addEventListener('change', apply);
  document.getElementById('mode-2d').addEventListener('change', apply);
  for (const input of document.querySelectorAll('input[name="table-kind"]')) {
    input.addEventListener('change', () => tableView.show(input.value));
  }
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
