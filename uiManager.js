// uiManager.js

class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;
    this._iterId          = null;

    // Role dropdown → full reload
    document.getElementById('sel-role')
      .addEventListener('change', () => this._onSelectionChange());

    // Start / Stop iteration
    document.getElementById('btn-start')
      .addEventListener('click', () => this._startIteration());
    document.getElementById('btn-stop')
      .addEventListener('click', () => this._stopIteration());

    // Zoom controls
    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    // When background fetch returns
    this.autoResolver.on('treeFetched', ({ data }) => {
      this.graphRenderer.mergeData(data);
      this.graphRenderer.refreshColors();
    });

    // On click of any node
    this.graphRenderer.on('nodeClicked', ({ node }) => {
      this._showDetails(node);
      this._loadSubtree(node);
    });
  }

  _getSelectedMappings() {
    return Array.from(
      document.querySelectorAll('input[name="mapping"]:checked'),
      cb => cb.value
    );
  }

  _onSelectionChange() {
    const role     = document.getElementById('sel-role').value;
    const mappings = this._getSelectedMappings();
    if (!role || mappings.length === 0) return;

    // Reset iteration
    this._stopIteration();

    // Reset graph state
    this.autoResolver.stop();
    this.selectionManager.loadedRoles.clear();
    this.selectionManager.roleStatus = {};
    this.selectionManager.setStartRole(role);
    this.selectionManager.setSelected(role);
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });

    // Initial batch load
    this.dataLoader.fetchTrees(role, mappings)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(role, data);
        this.graphRenderer.refreshColors();
        // Show root details
        const root = this.graphRenderer.graph.graphData().nodes
                        .find(n => n.id === role);
        if (root) this._showDetails(root);
      })
      .catch(err => {
        console.error('Initial load error', err);
        document.getElementById('details')
          .innerText = 'Error loading graph';
      });

    // Enqueue root for background resolution
    this.autoResolver.queue = [ role ];
    this.autoResolver.start(mappings);
  }

  _loadSubtree(node) {
    const mappings = this._getSelectedMappings();
    this.dataLoader.fetchTrees(node.id, mappings)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(node.id, data);
        this.graphRenderer.refreshColors();
      })
      .catch(err => console.error('Subtree load error for', node.id, err));
  }

  _showDetails(node) {
    const icon = node.logo?.class || 'fa-solid fa-cube';
    document.getElementById('details').innerHTML = `
      <h2 style="display:flex; align-items:center; margin:0 0 8px;">
        <i class="${icon}" style="margin-right:8px;"></i>
        <span>${node.id}</span>
      </h2>
      <p style="margin:0 0 12px;">${node.description || ''}</p>
      <p style="margin:0; font-size:14px;">
        <a href="${node.doc_url}"    target="_blank">Documentation</a><br/>
        <a href="${node.source_url}" target="_blank">Source Code</a>
      </p>
    `;
  }

  _startIteration() {
    if (this._iterId) return;
    const interval = parseFloat(
      document.getElementById('iter-interval').value
    ) * 1000;
    if (isNaN(interval) || interval <= 0) return;

    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled  = false;

    this._iterId = setInterval(() => {
      const next = this.graphRenderer.graph.graphData().nodes
        .find(n => this.selectionManager.getColor(n.id) === 'orange');
      if (!next) {
        this._stopIteration();
        return;
      }
      // “click” it
      this.selectionManager.setSelected(next.id);
      this._showDetails(next);
      this._loadSubtree(next);
    }, interval);
  }

  _stopIteration() {
    if (!this._iterId) return;
    clearInterval(this._iterId);
    this._iterId = null;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-stop').disabled  = true;
  }
}

window.UIManager = UIManager;
