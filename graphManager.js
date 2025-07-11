// graphManager.js (revised to use getElementById)
class GraphManager {
  constructor(containerId) {
    // containerId is the element id (without '#')
    this.container = document.getElementById(containerId);
    this.loadedRoles = new Set();
    this.roleStatus = new Map();
    this._initGraph();
  }

  _initGraph() {
    this.graph = ForceGraph3D()(this.container)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .nodeLabel(d => d.id)
      .nodeColor(d => this._getNodeColor(d))
      .onNodeClick(node => {
        this.options.onNodeClick && this.options.onNodeClick(node);
        this.loadRole(node.id, this.depKey);
      })
      .graphData({ nodes: [], links: [] });
  }

  _getNodeColor(node) {
    if (!this.loadedRoles.has(node.id)) return 'orange';
    return this.roleStatus.get(node.id) === 'leaf' ? 'red' : 'green';
  }

  setOptions(opts) {
    this.options = opts;
    this.depKey = opts.depKey;
  }

  reset() {
    this.loadedRoles.clear();
    this.roleStatus.clear();
    this.graph.graphData({ nodes: [], links: [] });
  }

  async loadRole(role, depKey) {
    if (this.loadedRoles.has(role)) return;
    const url = `/roles/${role}/meta/tree.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const allGraphs = await res.json();
      const subset = allGraphs[depKey] || { nodes: [], links: [] };
      this._processSubset(subset);
      this.loadedRoles.add(role);
    } catch (err) {
      console.error(err);
      this.options.onError && this.options.onError(err);
    }
  }

  _processSubset(subset) {
    subset.nodes.forEach(n => {
      const outgoing = subset.links.filter(l => l.source === n.id);
      this.roleStatus.set(n.id, outgoing.length ? 'internal' : 'leaf');
    });
    const { nodes: currNodes, links: currLinks } = this.graph.graphData();
    const existingIds = new Set(currNodes.map(n => n.id));
    const newNodes = subset.nodes.filter(n => !existingIds.has(n.id));
    const linkSign = l => `${l.source}->${l.target}`;
    const existingLinkSet = new Set(currLinks.map(linkSign));
    const newLinks = subset.links.filter(l => !existingLinkSet.has(linkSign(l)));
    this.graph.graphData({
      nodes: [...currNodes, ...newNodes],
      links: [...currLinks, ...newLinks]
    });
    this.graph.nodeColor(d => this._getNodeColor(d));
  }

  cameraZoom(factor) {
    const cam = this.graph.camera();
    cam.position.z *= factor;
    this.graph.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z }, cam.target, 300
    );
  }
}

// Export for global usage
window.GraphManager = GraphManager;
