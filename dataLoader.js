// dataLoader.js
class DataLoader {
  constructor(basePath = '/roles') {
    this.basePath = basePath;
  }

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
}
window.DataLoader = DataLoader;
