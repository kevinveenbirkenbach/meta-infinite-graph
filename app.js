// Read query params
const params = new URLSearchParams(window.location.search);
const selectedRole = params.get('role') || null;
const selectedDep  = params.get('dep')  || 'run_after';
const selectedDir  = params.get('dir')  || 'to';

// Fetch available roles from server-side JSON
fetch('/roles/list.json')
  .then(res => {
    if (!res.ok) throw new Error(`Failed to load roles list: ${res.status}`);
    return res.json();
  })
  .then(roles => {
    const selRole = document.getElementById('sel-role');
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (r === selectedRole) opt.selected = true;
      selRole.appendChild(opt);
    });

    // If no role in URL, default to first
    const currentRole = selectedRole || roles[0];
    if (!selectedRole) {
      params.set('role', currentRole);
      window.history.replaceState({}, '', `?${params}`);
    }

    // Set dependency and direction selects
    document.getElementById('sel-dep').value = selectedDep;
    document.getElementById('sel-dir').value = selectedDir;

    document.getElementById('btn-go').onclick = () => {
      const role = document.getElementById('sel-role').value;
      const dep  = document.getElementById('sel-dep').value;
      const dir  = document.getElementById('sel-dir').value;
      window.location.search = `?role=${role}&dep=${dep}&dir=${dir}`;
    };

    // Now fetch and render the graph
    loadGraph(currentRole, selectedDep, selectedDir);
  })
  .catch(err => {
    console.error(err);
    document.getElementById('sidebar').innerText = 'Error loading roles list';
  });

function loadGraph(role, dep, dir) {
  const treePath = `/roles/${role}/meta/tree.json`;
  fetch(treePath)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load ${treePath}: ${res.status}`);
      return res.json();
    })
    .then(allGraphs => {
      const key = `${dep}_${dir}`;
      const data = allGraphs[key];
      if (!data) throw new Error(`Graph key not found: ${key}`);

      ForceGraph3D()(document.getElementById('3d-graph'))
        .linkDirectionalArrowLength(4)
        .linkDirectionalArrowRelPos(1)
        .nodeLabel(d => d.id)
        .onNodeClick(node => {
          document.getElementById('sidebar').innerHTML = `
            <h2>${node.id}</h2>
            <p>${node.description || ''}</p>
            <p>
              <a href="${node.doc_url}" target="_blank">Documentation</a><br/>
              <a href="${node.source_url}" target="_blank">Source Code</a>
            </p>
          `;
        })
        .graphData(data);

      document.getElementById('sidebar').innerText = 'Click a node for details';
    })
    .catch(err => {
      console.error(err);
      document.getElementById('sidebar').innerText = 'Error loading graph data';
    });
}