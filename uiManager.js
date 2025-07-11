// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;

    // Listen for dropdown changes
    ['sel-role','sel-dep','sel-dir'].forEach(id => {
      document.getElementById(id)
        .addEventListener('change', () => this._onSelectionChange());
    });

    // Zoom buttons
    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    // Auto-resolve new data
    this.autoResolver.on('treeFetched', ({ data }) => {
      this.graphRenderer.mergeData(data);
      this.graphRenderer.refreshColors();
    });

    // On node click: fetch and merge that node's dependencies
    this.graphRenderer.on('nodeClicked', ({ node }) => this._onNodeClick(node));
  }

  _onSelectionChange() {
    const roleEl = document.getElementById('sel-role');
    const role   = roleEl.value;
    if (!role) {
      console.warn('No role selected—skipping graph load.');
      return;
    }
    const dep = document.getElementById('sel-dep').value;
    const dir = document.getElementById('sel-dir').value;
    this._reload(role, `${dep}_${dir}`);
  }

  _reload(role, depKey) {
    // Stop any in-flight auto-resolution
    this.autoResolver.stop();

    // Reset entire graph state
    this.selectionManager.loadedRoles.clear();
    this.selectionManager.roleStatus = {};
    this.selectionManager.setSelected(role);
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });

    // Start background auto-expansion
    this.autoResolver.start(depKey);

    // Initial subtree load
    this.dataLoader.fetchTree(role, depKey)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(role, data);
        this.graphRenderer.refreshColors();
      })
      .catch(err => {
        console.error('Error loading tree for', role, err);
        document.getElementById('sidebar').innerText = 'Error loading graph data';
      });
  }

  _onNodeClick(node) {
    // Load only the clicked node's subtree
    const dep = document.getElementById('sel-dep').value;
    const dir = document.getElementById('sel-dir').value;
    const key = `${dep}_${dir}`;

    this.dataLoader.fetchTree(node.id, key)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(node.id, data);
        this.graphRenderer.refreshColors();
      })
      .catch(err => {
        console.error('Error loading subtree for', node.id, err);
      });
  }
}

window.UIManager = UIManager;
