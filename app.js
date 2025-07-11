(function() {
  const selRoleEl = document.getElementById('sel-role');
  fetch('/roles/list.json')
    .then(res => res.json())
    .then(roles => {
      roles.forEach(r => selRoleEl.appendChild(new Option(r, r)));
      // Pass the element id, not selector
      const gm = new GraphManager('3d-graph');
      new UIManager(gm);
      document.getElementById('btn-go').click();
    })
    .catch(err => {
      console.error(err);
      document.getElementById('sidebar').innerText = 'Error loading roles list';
    });
})();