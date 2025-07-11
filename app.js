// app.js

// Core Manager instanziieren
const dataLoader       = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer    = new GraphRenderer('3d-graph', selectionManager);
const autoResolver     = new AutoResolver(dataLoader, selectionManager);
const uiManager        = new UIManager(
  dataLoader, selectionManager, graphRenderer, autoResolver
);

// URL‐Parameter helper
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    role:     p.get('role') || '',
    mappings: p.getAll('mapping')
  };
}

// Mapping‐Checkboxen bauen
function buildMappingControls(allKeys, checkedKeys) {
  const container = document.getElementById('mapping-controls');
  container.innerHTML = '';  // leeren
  allKeys.forEach(key => {
    const id = `cb_${key}`;
    const checked = checkedKeys.includes(key) ? 'checked' : '';
    container.insertAdjacentHTML('beforeend', `
      <div class="form-check form-check-sm">
        <input class="form-check-input" type="checkbox"
               name="mapping" value="${key}" id="${id}"
               ${checked}>
        <label class="form-check-label" for="${id}">
          ${key.replace(/_/g,' → ')}
        </label>
      </div>
    `);
    document.getElementById(id)
      .addEventListener('change', () => uiManager._onSelectionChange());
  });
}

// 1) Rollen‐Liste holen
fetch('/roles/list.json')
  .then(r => {
    if (!r.ok) throw new Error(`Status ${r.status}`);
    return r.json();
  })
  .then(roles => {
    const sel = document.getElementById('sel-role');
    roles.forEach(r => {
      const o = document.createElement('option');
      o.value = o.textContent = r;
      sel.appendChild(o);
    });

    // initial aus URL oder erstes Element
    const { role, mappings } = getParams();
    sel.value = role || roles[0] || '';
    sel.addEventListener('change', () => uiManager._onSelectionChange());

    // 2) Mappings für diese Rolle laden
    return dataLoader.getMappingsForRole(sel.value)
      .then(allKeys => ({ allKeys, mappings }));
  })
  .then(({ allKeys, mappings }) => {
    buildMappingControls(allKeys, mappings);
    // 3) initialen Graph schießen
    uiManager._onSelectionChange();
  })
  .catch(err => {
    console.error('Init error', err);
    document.getElementById('details')
      .innerText = 'Initialization failed';
  });
