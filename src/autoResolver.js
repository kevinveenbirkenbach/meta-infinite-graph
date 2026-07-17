// autoResolver.js
//
// Iterates outward from the start node: each tick it picks one node that is
// present in the graph but not yet expanded and expands it, until the
// reachable frontier is exhausted. All data is already in memory, so a tick
// never fetches.
class AutoResolver {
  constructor() {
    this.intervalId = null;
  }

  start(pickNext, expand, intervalMs = 500) {
    this.stop();
    const tick = () => {
      const role = pickNext();
      if (role) {
        expand(role);
      } else {
        this.stop();
      }
    };
    this.intervalId = setInterval(tick, intervalMs);
  }

  get running() {
    return this.intervalId !== null;
  }

  stop() {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}

window.AutoResolver = AutoResolver;
