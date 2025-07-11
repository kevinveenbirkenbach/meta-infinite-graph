// graphManager.js
class GraphManager {
  constructor(containerId) {
    this.container     = document.getElementById(containerId);
    this.selectedRole  = null;    // last-clicked node
    this.loadedRoles   = new Set(); // which roles we’ve fetched
    this._initGraph();
  }

  _initGraph() {
    this.Graph = ForceGraph3D()(this.container)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .nodeLabel(d => d.id)
      .onNodeClick(node => {
        // mark as selected and recolor
        this.selectedRole = node.id;
        this.Graph.nodeColor(n => this._getNodeColor(n.id));
        // then load its subtree
        this.loadRole(node.id, this.depKey);
      })
      .nodeColor(d => this._getNodeColor(d.id));
  }

  _getNodeColor(role) {
    // pink for the currently selected node
    if (role === this.selectedRole) return 'pink';

    // get full link list
    const { nodes, links } = this.Graph.graphData();

    // count incoming and outgoing
    let incoming = 0, outgoing = 0;
    for (const l of links) {
      if (l.source === role) outgoing++;
      if (l.target === role) incoming++;
    }

    // not yet loaded → light gray
    if (!this.loadedRoles.has(role)) return '#ccc';

    // pure sink (many incoming, no outgoing) → red
    if (outgoing === 0 && incoming > 0) return 'red';

    // through-node (both incoming and outgoing) → orange
    if (outgoing > 0 && incoming > 0) return 'orange';

    // pure source (outgoing, no incoming) → green
    if (outgoing > 0 && incoming === 0) return 'green';

    // completely isolated → gray
    return '#888';
  }

  reset() {
    this.Graph.graphData({ nodes: [], links: [] });
    this.loadedRoles.clear();
    this.selectedRole = null;
  }

  setDepKey(depKey) {
    this.depKey = depKey;
  }

  cameraZoom(factor) {
    const cam = this.Graph.camera();
    cam.position.z *= factor;
    this.Graph.cameraPosition(cam.position, 500);
  }

  loadRole(role, depKey) {
    this.depKey = depKey;            // remember for clicks
    if (this.loadedRoles.has(role)) return;  // already done

    fetch(`/roles/${role}/meta/tree.json`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load ${role}`);
        return r.json();
      })
      .then(all => {
        const data = all[depKey];
        if (!data) throw new Error(`Missing key ${depKey}`);

        // merge nodes & links
        const current = this.Graph.graphData();
        const map     = new Map(current.nodes.map(n=>[n.id,n]));
        data.nodes.forEach(n => {
          if (!map.has(n.id)) {
            current.nodes.push(n);
            map.set(n.id,n);
          }
        });
        current.links.push(...data.links);
        this.Graph.graphData(current);

        // mark as loaded and recolor
        this.loadedRoles.add(role);
        this.Graph.nodeColor(n => this._getNodeColor(n.id));
      })
      .catch(err => console.error(err));
  }
}

window.GraphManager = GraphManager;
