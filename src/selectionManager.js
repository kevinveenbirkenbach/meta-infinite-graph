// selectionManager.js

class SelectionManager {
  constructor() {
    this.loadedRoles  = new Set();
    this.roleStatus   = {};      // role → 'leaf' | 'internal'
    this.selectedRole = null;    // last-clicked
    this.startRole    = null;    // initially loaded root node
    this._listeners   = {};
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event]||[]).push(fn);
  }

  _emit(event, detail) {
    (this._listeners[event]||[]).forEach(fn => fn(detail));
  }

  // Mark a role as having its tree data loaded
  markLoaded(role, data) {
    this.loadedRoles.add(role);
    const sources = new Set(data.links.map(l => l.source));
    data.nodes.forEach(n => {
      this.roleStatus[n.id] = sources.has(n.id) ? 'internal' : 'leaf';
    });
    this._emit('statusChanged', { role });
  }

  // Called once at the very start
  setStartRole(role) {
    this.startRole = role;
    this._emit('startChanged', { role });
  }

  // Called on every click
  setSelected(role) {
    this.selectedRole = role;
    this._emit('selectionChanged', { role });
  }

  // Color logic giving the root node its own color
  getColor(role) {
    // 1) root node stays purple
    if (role === this.startRole)    return 'purple';
    // 2) last-clicked node is pink
    if (role === this.selectedRole) return 'pink';
    // 3) nodes not yet loaded are orange
    if (!this.loadedRoles.has(role)) return 'orange';
    // 4) leaf sinks (no outgoing deps) are red
    if (this.roleStatus[role] === 'leaf') return 'red';
    // 5) all other internal nodes are green
    return 'green';
  }
}

window.SelectionManager = SelectionManager;
