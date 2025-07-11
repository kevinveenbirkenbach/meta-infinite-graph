// uiManager.js
class UIManager {
  constructor(dataLoader, selectionManager, graphRenderer, autoResolver) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.graphRenderer    = graphRenderer;
    this.autoResolver     = autoResolver;

    // When role dropdown changes
    document.getElementById('sel-role')
      .addEventListener('change', () => {
        this._updateURL();
        this._onSelectionChange();
      });

    // Zoom buttons
    document.getElementById('btn-zoom-in')
      .addEventListener('click', () => this.graphRenderer.zoom(0.8));
    document.getElementById('btn-zoom-out')
      .addEventListener('click', () => this.graphRenderer.zoom(1.2));

    // Node‐click → show details + load subtree
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
    if (!role || mappings.length===0) return;

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
        // show details for the initial role
        const rootNode = this.graphRenderer.graph.graphData().nodes
                           .find(n => n.id===role);
        if (rootNode) this._showDetails(rootNode);
      })
      .catch(err => {
        console.error('Initial load error', err);
        document.getElementById('details').innerText = 'Error loading graph';
      });

    // then background‐resolve
    this.autoResolver.queue = [...mappings.map(_=>role)];
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
    const iconClass = node.logo?.class || 'fa-solid fa-cube';
    // <<< only update the DETAILS pane, not the entire sidebar >>>
    document.getElementById('details').innerHTML = `
      <h2 style="display:flex; align-items:center;">
        <i class="${iconClass}" style="margin-right:8px;"></i>
        <span>${node.id}</span>
      </h2>
      <p>${node.description || ''}</p>
      <p>
        <a href="${node.doc_url}"    target="_blank">Documentation</a><br/>
        <a href="${node.source_url}" target="_blank">Source Code</a>
      </p>
    `;
  }
}

window.UIManager = UIManager;
