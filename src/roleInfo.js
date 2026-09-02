class RoleInfo {
  constructor(dataLoader, metaGraph) {
    this.loader = dataLoader;
    this.graph = metaGraph;
    this.info = {};
    this.brands = {};
    this.symbols = false;
    this._promise = null;
  }

  load() {
    if (this._promise) return this._promise;
    this._promise = Promise.all([
      this.loader.loadSideFileAll(this.graph.roles, 'info'),
      this.loader.loadBrandIndex(),
    ]).then(([info, brands]) => {
      this.info = info;
      this.brands = brands;
      return this;
    });
    return this._promise;
  }

  iconFor(role) {
    const slug = this.brands[role];
    if (slug) {
      const img = document.createElement('img');
      img.className = 'role-icon';
      img.src = `vendor/simple-icons/${slug}.svg`;
      img.alt = role;
      return img;
    }
    const icon = document.createElement('i');
    const declared = this.info[role]?.logo?.class;
    icon.className = `role-icon ${declared || 'fa-regular fa-circle'}`;
    return icon;
  }

  label(role) {
    if (!this.symbols) {
      const span = document.createElement('span');
      span.textContent = role;
      return span;
    }
    return this.iconFor(role);
  }
}

window.RoleInfo = RoleInfo;
