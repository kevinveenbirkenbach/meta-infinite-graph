// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;

    // Dropdown changes trigger full reload & URL update
    ['sel-role','sel-dep','sel-dir'].forEach(id => {
      document.getElementById(id)
        .addEventListener('change', () => {
          this._updateURL();
          this._onSelectionChange();
        });
    });

    // Zoom buttons (URL need not change)
    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    // Auto‐resolve background fetch
    this.autoResolver.on('treeFetched', ({ data }) => {
      this.graphRenderer.mergeData(data);
      this.graphRenderer.refreshColors();
    });

    // On node click: show details AND load that node’s subtree
    this.graphRenderer.on('nodeClicked', ({ node }) => {
      this._showDetails(node);
      this._loadSubtree(node);
    });
  }

  // Write current dropdowns into URL querystring
  _updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('role', document.getElementById('sel-role').value);
    params.set('dep',  document.getElementById('sel-dep').value);
    params.set('dir',  document.getElementById('sel-dir').value);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.replaceState(null, '', newUrl);
  }

  _onSelectionChange() {
    const sel  = document.getElementById('sel-role');
    const role = sel.value;
    if (!role) return;
    const depKey = `${document.getElementById('sel-dep').value}_` +
                   document.getElementById('sel-dir').value;

    // Fully reload graph
    this.autoResolver.stop();
    this.selectionManager.loadedRoles.clear();
    this.selectionManager.roleStatus = {};
    this.selectionManager.setSelected(role);
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });

    this.autoResolver.start(depKey);
    this.dataLoader.fetchTree(role, depKey)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(role, data);
        this.graphRenderer.refreshColors();
        this._showDetails(
          this.graphRenderer.graph.graphData().nodes.find(n => n.id === role)
        );
      })
      .catch(err => {
        console.error('Error loading tree for', role, err);
        document.getElementById('sidebar').innerText = 'Error loading graph data';
      });
  }

  _loadSubtree(node) {
    const depKey = `${document.getElementById('sel-dep').value}_` +
                   document.getElementById('sel-dir').value;
    this.dataLoader.fetchTree(node.id, depKey)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(node.id, data);
        this.graphRenderer.refreshColors();
      })
      .catch(err => {
        console.error('Error loading subtree for', node.id, err);
      });
  }

  _showDetails(node) {
    const iconClass = node.logo?.class || 'fa-solid fa-cube';
    document.getElementById('sidebar').innerHTML = `
      <h2 style="display:flex; align-items:center;">
        <i class="${iconClass}" style="margin-right:8px;"></i>
        <span>${node.id}</span>
      </h2>
      <p>${node.description || ''}</p>
      <p>
        <a href="${node.doc_url}" target="_blank">Documentation</a><br/>
        <a href="${node.source_url}" target="_blank">Source Code</a>
      </p>
    `;
  }
}

window.UIManager = UIManager;
