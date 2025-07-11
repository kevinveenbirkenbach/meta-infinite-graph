// app.js

// Instantiate core managers
const dataLoader       = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer    = new GraphRenderer('3d-graph', selectionManager);
const autoResolver     = new AutoResolver(dataLoader, selectionManager);
const uiManager        = new UIManager(
  dataLoader, selectionManager, graphRenderer, autoResolver
);

// Populate the role dropdown, then trigger initial load if possible
fetch('/roles/list.json')
  .then(res => {
    if (!res.ok) throw new Error(`Failed to load roles list: ${res.status}`);
    return res.json();
  })
  .then(roles => {
    const sel = document.getElementById('sel-role');
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      sel.appendChild(opt);
    });
    // Only reload once there is a valid selection
    if (sel.value) {
      uiManager._onSelectionChange();
    }
  })
  .catch(err => {
    console.error('Error loading roles list:', err);
    document.getElementById('sidebar').innerText = 'Could not load roles list';
  });
