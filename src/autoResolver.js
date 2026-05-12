// autoResolver.js
class AutoResolver {
  constructor(dataLoader, selectionManager) {
    this.dataLoader       = dataLoader;
    this.selectionManager = selectionManager;
    this.queue            = [];
    this.intervalId       = null;
    this._listeners       = {};

    // enqueue every statusChanged role
    this.selectionManager.on('statusChanged', ({ role }) => {
      // only enqueue if never loaded before
      if (!this.selectionManager.loadedRoles.has(role)) {
        this.queue.push(role);
      }
    });
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event]||[]).push(fn);
  }
  _emit(event, detail) {
    (this._listeners[event]||[]).forEach(fn=>fn(detail));
  }

  start(depKey) {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      while (this.queue.length && this.selectionManager.loadedRoles.has(this.queue[0])) {
        this.queue.shift();
      }
      const next = this.queue.shift();
      if (next) {
        this.dataLoader.fetchTree(next, depKey)
          .then(data => {
            this._emit('treeFetched', { role: next, data });
            this.selectionManager.markLoaded(next, data);
          })
          .catch(console.error);
      } else {
        this.stop();
      }
    }, 2000);
  }

  stop() {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
window.AutoResolver = AutoResolver;
