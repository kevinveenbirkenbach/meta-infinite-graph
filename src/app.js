// app.js
//
// Boot: scan the roles tree, parse every meta/*.yml, build the derived
// graph index, then hand over to the UI. Everything after boot is
// in-memory; expanding nodes never refetches.

window.addEventListener('error', e => {
  const el = document.getElementById('details');
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
  document.getElementById('details').innerText = text;
}

setStatus('Scanning roles ...');

dataLoader
  .listRoles()
  .then(roles => {
    setStatus(`Loading meta of ${roles.length} roles ...`);
    return dataLoader.loadAll(roles, (done, total) => {
      if (done % 25 === 0 || done === total) {
        setStatus(`Loading meta ${done}/${total} ...`);
      }
    });
  })
  .then(metaByRole => {
    const metaGraph = new MetaGraph(metaByRole);
    const autoResolver = new AutoResolver();
    const uiManager = new UIManager(
      metaGraph, selectionManager, graphRenderer, autoResolver
    );

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
    window.__mig = { metaGraph, selectionManager, uiManager, graph: graphRenderer.graph };
  })
  .catch(err => {
    console.error('Init error', err);
    setStatus('Initialization failed: ' + err.message);
  });
