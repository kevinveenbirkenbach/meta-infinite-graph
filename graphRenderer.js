// graphRenderer.js
class GraphRenderer {
  constructor(containerId, selectionManager) {
    this.container        = document.getElementById(containerId);
    this.selectionManager = selectionManager;
    this._listeners       = {};

    // 1) Initialize the 3D graph
    this.graph = ForceGraph3D()(this.container)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .nodeLabel(d => d.id)
      .onNodeClick(node => {
        this.selectionManager.setSelected(node.id);
        this._emit('nodeClicked', { node });
      })
      .nodeColor(d => this.selectionManager.getColor(d.id));

    // 2) Initial resize to fit container
    this._resizeGraph();

    // 3) Observe future container resizes
    this._resizeObserver = new ResizeObserver(() => this._resizeGraph());
    this._resizeObserver.observe(this.container);
  }

  // Helper to update internal graph dimensions
  _resizeGraph() {
    const width  = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.graph.width(width).height(height);
  }
  
  on(event, fn) {
    (this._listeners[event] = this._listeners[event]||[]).push(fn);
  }
  _emit(event, detail) {
    (this._listeners[event]||[]).forEach(fn=>fn(detail));
  }

  mergeData(data) {
    const current = this.graph.graphData();
    const map     = new Map(current.nodes.map(n => [n.id, n]));
    data.nodes.forEach(n => {
      if (!map.has(n.id)) {
        current.nodes.push(n);
        map.set(n.id, n);
      }
    });
    current.links.push(...data.links);
    this.graph.graphData(current);
  }

  refreshColors() {
    this.graph.nodeColor(d => this.selectionManager.getColor(d.id));
  }

  zoom(factor) {
    const cam = this.graph.camera();
    cam.position.z *= factor;
    this.graph.cameraPosition(cam.position, 500);
  }
}
window.GraphRenderer = GraphRenderer;
