// selectionManager.js
class SelectionManager {
  constructor() {
    this.loadedRoles  = new Set();
    this.roleStatus   = {};      // role → 'leaf' | 'internal'
    this.selectedRole = null;
    this._listeners   = {};
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event]||[]).push(fn);
  }
  _emit(event, detail) {
    (this._listeners[event]||[]).forEach(fn=>fn(detail));
  }

  markLoaded(role, data) {
    this.loadedRoles.add(role);
    const sources = new Set(data.links.map(l => l.source));
    data.nodes.forEach(n => {
      this.roleStatus[n.id] = sources.has(n.id) ? 'internal' : 'leaf';
    });
    this._emit('statusChanged', { role });
  }

  setSelected(role) {
    this.selectedRole = role;
    this._emit('selectionChanged', { role });
  }

  getColor(role) {
    if (role === this.selectedRole) return 'pink';
    if (!this.loadedRoles.has(role))    return 'orange';
    return this.roleStatus[role] === 'leaf' ? 'red' : 'green';
  }
}
window.SelectionManager = SelectionManager;
