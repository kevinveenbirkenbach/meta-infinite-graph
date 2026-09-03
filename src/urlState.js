class UrlState {
  constructor() {
    this.controls = [];
  }

  // Args:
  //   fallback: the value that is left out of the URL, not one used on read.
  register(name, get, set, fallback) {
    this.controls.push({ name, get, set, fallback });
    return this;
  }

  params() {
    return new URLSearchParams(window.location.search);
  }

  apply(names) {
    const params = this.params();
    for (const control of this.controls) {
      if (names && !names.includes(control.name)) continue;
      const value = params.get(control.name);
      if (value !== null) control.set(value);
    }
  }

  capture() {
    const params = new URLSearchParams();
    for (const control of this.controls) {
      const value = String(control.get());
      if (value !== String(control.fallback) && value !== '') params.set(control.name, value);
    }
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }
}

window.UrlState = UrlState;
