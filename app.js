// app.js

const dataLoader       = new DataLoader('/roles');
const selectionManager = new SelectionManager();
const graphRenderer    = new GraphRenderer('3d-graph', selectionManager);
const autoResolver     = new AutoResolver(dataLoader, selectionManager);
const uiManager        = new UIManager(
  dataLoader, selectionManager, graphRenderer, autoResolver
);

// 1) Populate roles dropdown
fetch('/roles/list.json')
  .then(r => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  })
  .then(roles => {
    const sel = document.getElementById('sel-role');
    roles.forEach(r => {
      const o = document.createElement('option');
      o.value = o.textContent = r;
      sel.appendChild(o);
    });

    // 2) fetch mappings for initial selection
    sel.value = roles[0] || '';
    return dataLoader.getMappingsForRole(sel.value);
  })
  .then(allKeys => {
    // build mapping-checkbox controls
    const params = new URLSearchParams(window.location.search);
    const checked = params.getAll('mapping');
    const container = document.getElementById('mapping-controls');
    container.innerHTML = '<legend>Mappings</legend>';
    allKeys.forEach(key => {
      const id = `cb_${key}`;
      const isChecked = checked.includes(key) ? 'checked' : '';
      container.insertAdjacentHTML('beforeend', `
        <label>
          <input type="checkbox" name="mapping"
                 value="${key}" id="${id}" ${isChecked}>
          ${key.replace(/_/g,' → ')}
        </label><br/>
      `);
      document.getElementById(id)
        .addEventListener('change', () => uiManager._onSelectionChange());
    });

    // 3) initial graph load
    uiManager._onSelectionChange();
  })
  .catch(err => {
    console.error('Init error', err);
    document.getElementById('details')
      .innerText = 'Initialization failed';
  });
