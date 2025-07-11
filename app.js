// app.js

// Instantiate core managers
const dataLoader       = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer    = new GraphRenderer('3d-graph', selectionManager);
const autoResolver     = new AutoResolver(dataLoader, selectionManager);
const uiManager        = new UIManager(
  dataLoader, selectionManager, graphRenderer, autoResolver
);

// Helper to get a query‐param or fallback
function getParam(name, fallback) {
  const p = new URLSearchParams(window.location.search).get(name);
  return p || fallback;
}

// Populate the role dropdown, then trigger initial load if possible
fetch('/roles/list.json')
  .then(res => {
    if (!res.ok) throw new Error(`Failed to load roles list: ${res.status}`);
    return res.json();
  })
  .then(roles => {
    const selRole = document.getElementById('sel-role');
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      selRole.appendChild(opt);
    });

    // Read from URL or use first role
    const initialRole = getParam('role', selRole.options[0]?.value || '');
    selRole.value = initialRole;

    // Similarly for dep and dir
    document.getElementById('sel-dep').value = getParam('dep', 'run_after');
    document.getElementById('sel-dir').value = getParam('dir', 'to');

    // Now trigger the graph load
    uiManager._onSelectionChange();
  })
  .catch(err => {
    console.error('Error loading roles list:', err);
    document.getElementById('sidebar').innerText = 'Could not load roles list';
  });
