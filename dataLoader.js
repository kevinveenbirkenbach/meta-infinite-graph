// dataLoader.js
class DataLoader {
  constructor(basePath = '/roles') {
    this.basePath = basePath;
  }

  // 1) Liefert die verfügbaren Mapping-Keys aus tree.json
  getMappingsForRole(role) {
    const url = `${this.basePath}/${role}/meta/tree.json`;
    return fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        return res.json();
      })
      .then(all => Object.keys(all));  // z.B. ["run_after_to","run_after_from",...]
  }

  // 2) Alte Einzelauswahl – bleibt evtl. für Dropdown-Variante
  fetchTree(role, depKey) {
    const url = `${this.basePath}/${role}/meta/tree.json`;
    return fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        return res.json();
      })
      .then(all => {
        const data = all[depKey];
        if (!data) throw new Error(`Missing graph key: ${depKey}`);
        return data;
      });
  }

  // 3) Neu: mehrere Mapping-Keys auf einmal holen und zusammenführen
  fetchTrees(role, depKeys) {
    const url = `${this.basePath}/${role}/meta/tree.json`;
    return fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
        return res.json();
      })
      .then(all => {
        const merged = { nodes: [], links: [] };
        const seen   = new Set();
        depKeys.forEach(key => {
          const data = all[key] || { nodes: [], links: [] };
          data.nodes.forEach(n => {
            if (!seen.has(n.id)) {
              seen.add(n.id);
              merged.nodes.push(n);
            }
          });
          merged.links.push(...data.links);
        });
        return merged;
      });
  }
}

window.DataLoader = DataLoader;
