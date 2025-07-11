// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;
    this._iterId          = null;

    // Role dropdown
    document.getElementById('sel-role')
      .addEventListener('change', () => {
        this._updateURL();
        this._onSelectionChange();
      });

    // Start ▶
    document.getElementById('btn-start')
      .addEventListener('click', () => this._startIteration());

    // Stop ⏸
    document.getElementById('btn-stop')
      .addEventListener('click', () => this._stopIteration());

    // Zoom In/Out
    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    // Node click → show details + load subtree
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

  _updateURL() {
    const params = new URLSearchParams();
    params.set('role', document.getElementById('sel-role').value);
    this._getSelectedMappings().forEach(m => params.append('mapping', m));
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  _onSelectionChange() {
    const role     = document.getElementById('sel-role').value;
    const mappings = this._getSelectedMappings();
    if (!role || mappings.length === 0) return;

    // stop any auto‐iteration
    this._stopIteration();

    // reset graph
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
        // show root details
        const root = this.graphRenderer.graph.graphData().nodes
                        .find(n => n.id === role);
        if (root) this._showDetails(root);
      })
      .catch(err => {
        console.error('Initial load error', err);
        document.getElementById('details').innerText = 'Error loading graph';
      });

    // background queue
    this.autoResolver.queue = mappings.map(_=>role);
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
      <h2 style="display:flex; align-items:center;">
        <i class="${icon}" style="margin-right:8px;"></i>
        <span>${node.id}</span>
      </h2>
      <p>${node.description || ''}</p>
      <p>
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
    if (!this._iterId) return;
    clearInterval(this._iterId);
    this._iterId = null;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-stop').disabled  = true;
  }
}

window.UIManager = UIManager;
