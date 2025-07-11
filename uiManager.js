// uiManager.js
class UIManager {
  constructor(graphManager) {
    this.graphManager = graphManager;
    this._bindControls();
    this._initialLoad();
  }

  _bindControls() {
    // On any select change, reload
    ['sel-role', 'sel-dep', 'sel-dir'].forEach(id => {
      document.getElementById(id)
        .addEventListener('change', () => this._onLoad());
    });

    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphManager.cameraZoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphManager.cameraZoom(1.2));
  }

  _initialLoad() {
    // Perform first load once the role list is populated
    // (app.js should call this after filling sel-role)
    this._onLoad();
  }

  _onLoad() {
    const role = document.getElementById('sel-role').value;
    const dep  = document.getElementById('sel-dep').value;
    const dir  = document.getElementById('sel-dir').value;
    const key  = `${dep}_${dir}`;

    this.graphManager.reset();
    this.graphManager.setOptions({
      onNodeClick: node => this.showDetails(node),
      onError:     err  => this.showError(err),
      depKey:      key
    });
    this.graphManager.loadRole(role, key);
  }

  showDetails(node) {
    const iconClass = (node.logo && node.logo.class)
      ? node.logo.class
      : 'fa-solid fa-cube';

    document.getElementById('sidebar').innerHTML = `
      <h2>
        <i class="${iconClass}" style="margin-right:8px;"></i>
        ${node.id}
      </h2>
      <p>${node.description || ''}</p>
      <p>
        <a href="${node.doc_url}" target="_blank">Documentation</a><br/>
        <a href="${node.source_url}" target="_blank">Source Code</a>
      </p>
    `;
  }

  showError(err) {
    document.getElementById('sidebar')
      .innerText = 'Error loading graph data';
  }
}

window.UIManager = UIManager;
