// app.js

// Instantiate core managers
const dataLoader       = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer    = new GraphRenderer('3d-graph', selectionManager);
const autoResolver     = new AutoResolver(dataLoader, selectionManager);
const uiManager        = new UIManager(
  dataLoader, selectionManager, graphRenderer, autoResolver
);

// Helper, liest URL‐Parameter
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    role:     p.get('role'),
    mappings: p.getAll('mapping')  // mehrere
  };
}

// Baut die Checkboxen dynamisch aus den Mapping-Keys
function buildMappingControls(allKeys, initiallyChecked) {
  const container = document.getElementById('mapping-controls');
  container.innerHTML = '<legend>Mappings</legend>';
  allKeys.forEach(key => {
    const id = `cb_${key}`;
    const checked = initiallyChecked.includes(key) ? 'checked' : '';
    container.insertAdjacentHTML('beforeend', `
      <label>
        <input type="checkbox"
               name="mapping"
               value="${key}"
               id="${id}"
               ${checked}>
        ${key.replace(/_/g, ' → ')}
      </label><br/>
    `);
    document.getElementById(id)
      .addEventListener('change', () => {
        uiManager._updateURL();
        uiManager._onSelectionChange();
      });
  });
}

// 1) Rollen‐Liste holen
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

    // URL‐Werte oder Standard
    const { role, mappings } = getParams();
    selRole.value = role || roles[0] || '';
    selRole.dispatchEvent(new Event('change'));

    // 2) Mapping‐Keys vom Server ziehen
    return dataLoader.getMappingsForRole(selRole.value)
      .then(allKeys => ({ allKeys, mappings }));
  })
  .then(({ allKeys, mappings }) => {
    // Checkboxen bauen
    buildMappingControls(allKeys, mappings);
    // 3) initialen Graph laden
    uiManager._onSelectionChange();
  })
  .catch(err => {
    console.error('Init error:', err);
    document.getElementById('sidebar').innerText = 'Initialization failed';
  });
  