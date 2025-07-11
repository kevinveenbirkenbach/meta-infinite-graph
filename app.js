// app.js (incremental loading, auto subtree load on click, zoom controls, node coloring)

// Read query params
const params = new URLSearchParams(window.location.search);
let selectedRole = params.get('role') || null;
let selectedDep  = params.get('dep')  || 'run_after';
let selectedDir  = params.get('dir')  || 'to';

// Global graph instance and cache
let Graph;
const loadedRoles = new Set();
// track leaf status: 'leaf' or 'internal'
const roleStatus = new Map();

// Fetch available roles for dropdown
fetch('/roles/list.json')
  .then(res => res.ok ? res.json() : Promise.reject(res.status))
  .then(roles => initializeControls(roles))
  .catch(err => {
    console.error(err);
    document.getElementById('sidebar').innerText = 'Error loading roles list';
  });

function initializeControls(roles) {
  const selRole = document.getElementById('sel-role');
  roles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    if (r === selectedRole) opt.selected = true;
    selRole.appendChild(opt);
  });

  if (!selectedRole && roles.length) {
    selectedRole = roles[0];
    params.set('role', selectedRole);
    window.history.replaceState({}, '', `?${params}`);
    selRole.value = selectedRole;
  }
  document.getElementById('sel-dep').value = selectedDep;
  document.getElementById('sel-dir').value = selectedDir;

  document.getElementById('btn-go').onclick = () => {
    selectedRole = selRole.value;
    selectedDep  = document.getElementById('sel-dep').value;
    selectedDir  = document.getElementById('sel-dir').value;
    params.set('role', selectedRole);
    params.set('dep', selectedDep);
    params.set('dir', selectedDir);
    window.history.replaceState({}, '', `?${params}`);
    resetGraph();
    loadTree(selectedRole);
  };

  // Initialize graph
  Graph = ForceGraph3D()(document.getElementById('3d-graph'))
    .linkDirectionalArrowLength(4)
    .linkDirectionalArrowRelPos(1)
    .nodeLabel(d => d.id)
    // color nodes: red = loaded leaf, green = loaded internal, orange = not loaded
    .nodeColor(d => {
      if (loadedRoles.has(d.id)) {
        return roleStatus.get(d.id) === 'leaf' ? 'red' : 'green';
      }
      return 'orange';
    })
    .onNodeClick(node => {
      showDetails(node);
      loadTree(node.id);
    })
    .graphData({ nodes: [], links: [] });

  // Zoom controls via camera
  document.getElementById('btn-zoom-in').onclick = () => {
    const cam = Graph.camera();
    cam.position.z *= 0.8;
    Graph.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      cam.target,
      300
    );
  };
  document.getElementById('btn-zoom-out').onclick = () => {
    const cam = Graph.camera();
    cam.position.z *= 1.2;
    Graph.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      cam.target,
      300
    );
  };

  resetGraph();
  loadTree(selectedRole);
}

function resetGraph() {
  loadedRoles.clear();
  roleStatus.clear();
  Graph.graphData({ nodes: [], links: [] });
}

function loadTree(role) {
  if (loadedRoles.has(role)) return;
  // Mark as loaded
  loadedRoles.add(role);

  const treePath = `/roles/${role}/meta/tree.json`;
  fetch(treePath)
    .then(res => res.ok ? res.json() : Promise.reject(res.status))
    .then(allGraphs => {
      const key = `${selectedDep}_${selectedDir}`;
      const subset = allGraphs[key];
      if (!subset) throw new Error(`Graph key not found: ${key}`);

      // Determine leaf status
      const outgoing = subset.links.filter(l => l.source === role);
      roleStatus.set(role, outgoing.length === 0 ? 'leaf' : 'internal');

      // Merge nodes and links
      const current = Graph.graphData();
      const existingNodes = new Set(current.nodes.map(n => n.id));
      const newNodes = subset.nodes.filter(n => !existingNodes.has(n.id));
      const existingLinks = new Set(current.links.map(l => `${l.source}->${l.target}`));
      const newLinks = subset.links.filter(l => !existingLinks.has(`${l.source}->${l.target}`));

      Graph.graphData({
        nodes: [...current.nodes, ...newNodes],
        links: [...current.links, ...newLinks]
      });

      // Refresh colors after merge
      Graph.nodeColor(d => {
        if (loadedRoles.has(d.id)) {
          return roleStatus.get(d.id) === 'leaf' ? 'red' : 'green';
        }
        return 'orange';
      });
    })
    .catch(err => {
      console.error(err);
      document.getElementById('sidebar').innerText = 'Error loading graph data';
    });
}

function showDetails(node) {
  document.getElementById('sidebar').innerHTML = `
    <h2>${node.id}</h2>
    <p>${node.description || ''}</p>
    <p>
      <a href="${node.doc_url}" target="_blank">Documentation</a><br/>
      <a href="${node.source_url}" target="_blank">Source Code</a>
    </p>
  `;
}
