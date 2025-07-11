// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;

    // Dropdown changes trigger full reload
    ['sel-role','sel-dep','sel-dir'].forEach(id => {
      document.getElementById(id)
        .addEventListener('change', () => this._onSelectionChange());
    });

    // Zoom buttons
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
          // find the node object we just added
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
    // icon (if any) or default
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
