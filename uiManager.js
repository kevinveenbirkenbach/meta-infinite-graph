// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;
    this._iterId          = null;

    // bind
    document.getElementById('sel-role')
      .addEventListener('change', () => this._onSelectionChange());
    document.getElementById('btn-reload')
  .addEventListener('click', () => this._onSelectionChange());
    document.getElementById('btn-start')
      .addEventListener('click',  () => this._startIteration());
    document.getElementById('btn-stop')
      .addEventListener('click',   () => this._stopIteration());
    document.getElementById('btn-zoom-in')
      .addEventListener('click',  () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    this.graphRenderer.on('nodeClicked', ({ node }) => {
      this._showDetails(node);
      this._loadSubtree(node);
    });
    this.autoResolver.on('treeFetched', ({ data }) => {
      this.graphRenderer.mergeData(data);
      this.graphRenderer.refreshColors();
    });
  }

  _getCheckedMappings() {
    return Array.from(
      document.querySelectorAll('input[name="mapping"]:checked'),
      cb => cb.value
    );
  }

  _onSelectionChange() {
    const role     = document.getElementById('sel-role').value;
    const mappings = this._getCheckedMappings();

    // URL-Parameter aktualisieren, ohne Neuladen
    updateUrlParams(role, mappings);

    if (!role || mappings.length === 0) return;

    // mark root
    this.selectionManager.setStartRole(role);
    // reset
    this.autoResolver.stop();
    this.selectionManager.loadedRoles.clear();
    this.selectionManager.roleStatus = {};
    this.selectionManager.setSelected(role);
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });

    // initial fetch
    this.dataLoader.fetchTrees(role, mappings)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(role, data);
        this.graphRenderer.refreshColors();
        const rootNode = data.nodes.find(n => n.id === role);
        if (rootNode) this._showDetails(rootNode);
        // enqueue for background resolver
        this.autoResolver.queue = [role];
        this.autoResolver.start(mappings);
      })
      .catch(err => {
        console.error('Error loading tree for', role, err);
        document.getElementById('details').textContent =
          'Error loading graph data';
      });
  }

  _loadSubtree(node) {
    const mappings = this._getCheckedMappings();
    this.dataLoader.fetchTrees(node.id, mappings)
      .then(data => {
        this.graphRenderer.mergeData(data);
        this.selectionManager.markLoaded(node.id, data);
        this.graphRenderer.refreshColors();
      })
      .catch(err => console.error(err));
  }

  _showDetails(node) {
    const icon = node.logo?.class || 'fa-solid fa-cube';
    document.getElementById('details').innerHTML = `
      <h6 class="d-flex align-items-center mb-2">
        <i class="${icon} me-2"></i>${node.id}
      </h6>
      <p class="small text-wrap mb-2" style="max-height:120px; overflow:auto;">
        ${node.description || ''}
      </p>
      <p class="small mb-0">
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
      if (next) {
        this.selectionManager.setSelected(next.id);
        this._showDetails(next);
        this._loadSubtree(next);
      } else {
        this._stopIteration();
      }
    }, interval);
  }

  _stopIteration() {
    clearInterval(this._iterId);
    this._iterId = null;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-stop').disabled  = true;
  }
}

// Hilfsfunktion zum Setzen der GET-Parameter in der URL
function updateUrlParams(role, mappings) {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  mappings.forEach(m => params.append('mapping', m));
  history.replaceState(null, '', `?${params.toString()}`);
}

window.UIManager = UIManager;
