// uiManager.js
class UIManager {
  constructor(graphManager) {
    this.graphManager = graphManager;
    this._bindControls();
  }

  _bindControls() {
    document.getElementById('btn-go').addEventListener('click', () => this._onLoad());
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.graphManager.cameraZoom(0.8));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.graphManager.cameraZoom(1.2));
  }

  _onLoad() {
    const role = document.getElementById('sel-role').value;
    const dep = document.getElementById('sel-dep').value;
    const dir = document.getElementById('sel-dir').value;
    const key = `${dep}_${dir}`;
    this.graphManager.reset();
    this.graphManager.setOptions({
      onNodeClick: node => this.showDetails(node),
      onError: err => this.showError(err),
      depKey: key
    });
    this.graphManager.loadRole(role, key);
  }

  showDetails(node) {
    document.getElementById('sidebar').innerHTML = `
      <h2>${node.id}</h2>
      <p>${node.description || ''}</p>
      <p>
        <a href="${node.doc_url}" target="_blank">Documentation</a><br/>
        <a href="${node.source_url}" target="_blank">Source Code</a>
      </p>
    `;
  }

  showError(err) {
    document.getElementById('sidebar').innerText = 'Error loading graph data';
  }
}