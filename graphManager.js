// graphManager.js
class GraphManager {
  constructor(containerId) {
    this.container       = document.getElementById(containerId);
    this.loadedRoles     = new Set();
    this.roleStatus      = {};      // role → 'leaf' | 'internal'
    this.selectedRole    = null;    // the last-clicked or initially loaded role
    this.options         = { depKey: '' };
    this._initGraph();
  }

  _initGraph() {
    this.Graph = ForceGraph3D()(this.container)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .nodeLabel(d => d.id)
      .onNodeClick(node => {
        // mark this node as the new “selected” role
        this.selectedRole = node.id;
        if (this.options.onNodeClick) this.options.onNodeClick(node);
        this.loadRole(node.id, this.options.depKey);
      })
      .nodeColor(node => this._getNodeColor(node.id));
  }

  _getNodeColor(role) {
    // always pink for the currently selected role
    if (role === this.selectedRole) {
      return 'pink';
    }
    // not yet loaded at all
    if (!this.loadedRoles.has(role)) {
      return 'orange';
    }
    // loaded and leaf → red
    if (this.roleStatus[role] === 'leaf') {
      return 'red';
    }
    // loaded and internal → green
    return 'green';
  }

  reset() {
    this.Graph.graphData({ nodes: [], links: [] });
    this.loadedRoles.clear();
    this.roleStatus   = {};
    this.selectedRole = null;
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
  }

  cameraZoom(factor) {
    const cam = this.Graph.camera();
    cam.position.z *= factor;
    this.Graph.cameraPosition(cam.position, 500);
  }

  loadRole(role, depKey) {
    // If nothing selected yet (initial load), mark this as selected
    if (!this.selectedRole) this.selectedRole = role;

    // avoid fetching the same subtree twice
    if (this.loadedRoles.has(role)) {
      // but still recolor now that selectedRole changed
      this.Graph.nodeColor(r => this._getNodeColor(r.id));
      return;
    }

    const path = `/roles/${role}/meta/tree.json`;
    fetch(path)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
        return res.json();
      })
      .then(allGraphs => {
        const data = allGraphs[depKey];
        if (!data) throw new Error(`Missing graph key: ${depKey}`);

        // merge into existing graph
        const current = this.Graph.graphData();
        const nodeMap = new Map(current.nodes.map(n => [n.id, n]));
        data.nodes.forEach(n => {
          if (!nodeMap.has(n.id)) {
            current.nodes.push(n);
            nodeMap.set(n.id, n);
          }
        });
        current.links.push(...data.links);
        this.Graph.graphData(current);

        // mark as loaded
        this.loadedRoles.add(role);

        // compute statuses: any loaded node with outgoing edges is internal
        const sources = new Set(data.links.map(l => l.source));
        data.nodes.forEach(n => {
          this.roleStatus[n.id] = sources.has(n.id) ? 'internal' : 'leaf';
        });

        // refresh coloring
        this.Graph.nodeColor(n => this._getNodeColor(n.id));
      })
      .catch(err => {
        if (this.options.onError) this.options.onError(err);
      });
  }
}

// expose globally if not bundling
window.GraphManager = GraphManager;
