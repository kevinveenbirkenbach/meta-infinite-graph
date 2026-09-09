// uiManager.js
//
// Wires the sidebar to the MetaGraph: edge-kind toggles, attribute facet
// filters (author / lifecycle / deploy mode), node expansion and the
// details panel showing every scanned meta attribute.
class UIManager {
  constructor(metaGraph, selectionManager, graphRenderer, autoResolver) {
    this.metaGraph = metaGraph;
    this.selectionManager = selectionManager;
    this.graphRenderer = graphRenderer;
    this.autoResolver = autoResolver;
    this._iterId = null;

    document.getElementById('sel-role')
      .addEventListener('change', () => this.onSelectionChange());
    document.getElementById('btn-reload')
      .addEventListener('click', () => this.onSelectionChange());
    document.getElementById('btn-start')
      .addEventListener('click', () => this._startIteration());
    document.getElementById('btn-stop')
      .addEventListener('click', () => this._stopIteration());
    document.getElementById('btn-flow')
      .addEventListener('click', () => this.showRunAfterFlow());

    for (const id of ['edge-dependencies', 'edge-dependents', 'edge-run-after', 'edge-role-deps', 'edge-role-dependents']) {
      document.getElementById(id)
        .addEventListener('change', () => this.onSelectionChange());
    }

    document.getElementById('edge-visible')
      .addEventListener('change', e => this.graphRenderer.setLinksVisible(e.target.checked));

    this.graphRenderer.on('nodeClicked', ({ node }) => {
      this.expand(node.id);
    });
  }

  setVariants(raw) {
    this.metaGraph.setVariants(raw);
  }

  setVariantAware(flag) {
    this.metaGraph.variantAware = flag;
    this.onSelectionChange();
  }

  // The next graph node that has appeared but is not yet expanded.
  _nextPending() {
    const pending = this.graphRenderer.graph.graphData().nodes
      .find(n => !this.selectionManager.loadedRoles.has(n.id));
    return pending ? pending.id : null;
  }

  edgeKinds() {
    return {
      dependencies: document.getElementById('edge-dependencies').checked,
      dependents: document.getElementById('edge-dependents').checked,
      runAfter: document.getElementById('edge-run-after').checked,
      roleDependencies: document.getElementById('edge-role-deps').checked,
      roleDependents: document.getElementById('edge-role-dependents').checked,
    };
  }

  filters() {
    return {
      author: document.getElementById('facet-author').value,
      lifecycle: document.getElementById('facet-lifecycle').value,
      mode: document.getElementById('facet-mode').value,
    };
  }

  buildFacetControls() {
    const facets = this.metaGraph.facets();
    const fill = (id, entries) => {
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="">all</option>';
      entries.forEach(([value, count]) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = `${value} (${count})`;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => this.onSelectionChange());
    };
    fill('facet-author', facets.author);
    fill('facet-lifecycle', facets.lifecycle);
    fill('facet-mode', facets.modes);
  }

  _subgraph(role) {
    const filters = this.filters();
    const edges = this.metaGraph
      .neighborhood(role, this.edgeKinds())
      .filter(e =>
        this.metaGraph.matches(e.source, filters) &&
        this.metaGraph.matches(e.target, filters)
      );
    const roleIds = new Set([role]);
    edges.forEach(e => {
      roleIds.add(e.source);
      roleIds.add(e.target);
    });
    return {
      nodes: [...roleIds].map(r => this.metaGraph.node(r)),
      links: edges.map(e => ({ ...e })),
    };
  }

  onSelectionChange() {
    const role = document.getElementById('sel-role').value;
    if (!role) return;
    if (window.urlState) window.urlState.capture();

    this.selectionManager.setStartRole(role);
    this.autoResolver.stop();
    this.autoResolver.queue = [role];
    this.selectionManager.loadedRoles.clear();
    this.selectionManager.roleStatus = {};
    this.selectionManager.setSelected(role);
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });

    const data = this._subgraph(role);
    this.graphRenderer.mergeData(data);
    this.selectionManager.markLoaded(role, data);
    this.graphRenderer.refreshColors();

    // Auto-iterate outward from the start node; pending nodes carry the
    // loading marker until the resolver reaches them.
    this._startIteration();
  }

  // Global run_after flow: every ordering edge at once, no start role.
  showRunAfterFlow() {
    const filters = this.filters();
    const edges = this.metaGraph.edges.filter(e =>
      e.kind === 'run_after' &&
      this.metaGraph.matches(e.source, filters) &&
      this.metaGraph.matches(e.target, filters)
    );
    const roleIds = new Set();
    edges.forEach(e => {
      roleIds.add(e.source);
      roleIds.add(e.target);
    });
    this.autoResolver.stop();
    this.graphRenderer.graph.graphData({ nodes: [], links: [] });
    this.graphRenderer.mergeData({
      nodes: [...roleIds].map(r => this.metaGraph.node(r)),
      links: edges.map(e => ({ ...e })),
    });
    roleIds.forEach(r => this.selectionManager.loadedRoles.add(r));
    this.graphRenderer.refreshColors();
    setStatus(`run_after flow: ${roleIds.size} roles, ${edges.length} ordering edges`);
  }

  expand(role) {
    const data = this._subgraph(role);
    this.graphRenderer.mergeData(data);
    this.selectionManager.markLoaded(role, data);
    this.graphRenderer.refreshColors();
  }

  _startIteration() {
    const interval = parseFloat(
      document.getElementById('iter-interval').value
    ) * 1000;
    if (isNaN(interval) || interval <= 0) return;
    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-stop').disabled = false;
    this.autoResolver.start(
      () => this._nextPending(),
      role => this.expand(role),
      interval
    );
  }

  _stopIteration() {
    this.autoResolver.stop();
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-stop').disabled = true;
  }
}

window.UIManager = UIManager;
