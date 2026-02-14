// graphRenderer.js

/**
 * Renders a 3D force‑directed graph into a given container,
 * and makes sure the graph always fills the visible viewport
 * (even when DevTools opens/closes, iframe resizes, etc.).
 */
class GraphRenderer {
  /**
   * @param {string} containerId        ID of the DIV to mount the graph into
   * @param {SelectionManager} selectionManager  Provides node color logic
   */
  constructor(containerId, selectionManager) {
    // 1) Store references
    this.container        = document.getElementById(containerId);
    this.selectionManager = selectionManager;
    this._listeners       = {};

    // 2) Instantiate the ForceGraph3D and attach it
    this.graph = ForceGraph3D()(this.container)
      .linkDirectionalArrowLength(4)       
      .linkDirectionalArrowRelPos(1)       
      .nodeLabel(d => d.id)                
      .onNodeClick(node => {
        // Forward click event upstream
        this.selectionManager.setSelected(node.id);
        this._emit('nodeClicked', { node });
      })
      .nodeColor(d => this.selectionManager.getColor(d.id));  

    // 3) Resize helper: always use viewport dimensions
    this._resizeGraph = () => {
      // Use window.innerWidth/innerHeight so opening DevTools (which shrinks viewport)
      // is always captured
      const width  = window.innerWidth;
      const height = window.innerHeight;
      this.graph.width(width).height(height);
    };

    // 4) Initial resize
    this._resizeGraph();

    // 5) Listen for window resize events (fired when DevTools toggles)
    window.addEventListener('resize', this._resizeGraph);
    window.addEventListener('orientationchange', this._resizeGraph);

    // 6) If available, also listen to visualViewport (more granular)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._resizeGraph);
    }

    // 7) Poll as a final fallback (in case some resize events aren’t firing)
    this._last = { w: window.innerWidth, h: window.innerHeight };
    this._pollId = setInterval(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w !== this._last.w || h !== this._last.h) {
        this._last = { w, h };
        this._resizeGraph();
      }
    }, 200);
  }

  /**
   * Subscribe to renderer events (e.g. 'nodeClicked').
   */
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
  }

  _emit(event, detail) {
    (this._listeners[event] || []).forEach(fn => fn(detail));
  }

  /**
   * Merge new nodes & links into the existing graph without duplicates.
   */
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

  /**
   * Re-apply node colors using SelectionManager’s logic.
   */
  refreshColors() {
    this.graph.nodeColor(d => this.selectionManager.getColor(d.id));
  }

  /**
   * Zoom the camera by a factor (<1 zooms in, >1 zooms out).
   */
  zoom(factor) {
    const cam = this.graph.camera();
    cam.position.z *= factor;
    this.graph.cameraPosition(cam.position, 500);
  }

  /**
   * Clean up listeners/pollers if needed.
   */
  destroy() {
    window.removeEventListener('resize', this._resizeGraph);
    window.removeEventListener('orientationchange', this._resizeGraph);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._resizeGraph);
    }
    clearInterval(this._pollId);
  }
}

// Expose globally
window.GraphRenderer = GraphRenderer;
