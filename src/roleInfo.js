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

  // Returns: an embeddable URL for a single video or an explicit playlist,
  //   null for a channel or a video index page.
  static embedUrl(video) {
    let url;
    try {
      url = new URL(video);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const params = url.searchParams;
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch' && params.get('v')) {
        return `https://www.youtube-nocookie.com/embed/${params.get('v')}`;
      }
      if (url.pathname === '/playlist' && params.get('list')) {
        return `https://www.youtube-nocookie.com/embed/videoseries?list=${params.get('list')}`;
      }
      if (url.pathname.startsWith('/embed/')) return url.href;
      return null;
    }
    const peertube = url.pathname.match(/^\/(?:w|videos\/watch)\/([\w-]+)\/?$/);
    return peertube ? `${url.origin}/videos/embed/${peertube[1]}` : null;
  }

  static player(video) {
    const embed = RoleInfo.embedUrl(video);
    if (!embed) return null;
    const frame = document.createElement('iframe');
    frame.className = 'role-card-video';
    frame.src = embed;
    frame.loading = 'lazy';
    frame.allow = 'accelerometer; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    // YouTube authorises an embed by its referrer and answers "error 153"
    // without one, so the policy has to leave at least the origin in place.
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    return frame;
  }

  label(role) {
    if (!this.symbols) {
      const span = document.createElement('span');
      span.textContent = role;
      return span;
    }
    return this.iconFor(role);
  }

  card(role) {
    const info = this.info[role] || {};
    const attributes = this.graph.attributes[role] || {};
    const card = document.createElement('div');
    card.className = 'role-card';

    const heading = document.createElement('div');
    heading.className = 'role-card-title';
    heading.appendChild(this.iconFor(role));
    heading.appendChild(document.createTextNode(` ${role}`));
    card.appendChild(heading);

    if (attributes.lifecycle) {
      const badge = document.createElement('span');
      badge.className = `role-card-badge lifecycle-${attributes.lifecycle}`;
      badge.textContent = attributes.lifecycle;
      heading.appendChild(badge);
    }

    if (attributes.description) {
      const description = document.createElement('p');
      description.className = 'role-card-desc';
      description.textContent = attributes.description;
      card.appendChild(description);
    }

    const facts = document.createElement('dl');
    facts.className = 'role-card-facts';
    const scalars = [
      ['Weight', String(this.graph.weight(role))],
      ['Provides', attributes.provides],
      ['Modes', (attributes.modes || []).join(', ')],
      ['Author', attributes.author],
      ['License', attributes.license],
    ].filter(([, value]) => value);
    for (const [name, value] of scalars) {
      const term = document.createElement('dt');
      term.textContent = name;
      const definition = document.createElement('dd');
      definition.textContent = value;
      facts.append(term, definition);
    }
    for (const [name, items] of [
      ['Services', attributes.services || []],
      ['Tags', attributes.galaxy_tags || []],
    ]) {
      if (!items.length) continue;
      const term = document.createElement('dt');
      term.textContent = name;
      const definition = document.createElement('dd');
      definition.className = 'chips';
      for (const item of items) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = item;
        definition.appendChild(chip);
      }
      facts.append(term, definition);
    }
    if (facts.childElementCount) card.appendChild(facts);

    const player = info.video ? RoleInfo.player(info.video) : null;
    if (player) card.appendChild(player);

    const links = document.createElement('div');
    links.className = 'role-card-links';
    const entries = [['Homepage', info.homepage]];
    if (info.video) entries.push([player ? 'Watch on site' : 'Video', info.video]);
    for (const [text, href] of entries) {
      if (!href) continue;
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = text;
      links.appendChild(link);
    }
    if (links.childElementCount) card.appendChild(links);
    return card;
  }
}

class RoleCardHost {
  constructor(roleInfo) {
    this.roleInfo = roleInfo;
    this.cards = new Map();
  }

  static LINGER = 500;

  static FADE = 500;

  has(role) {
    return this.cards.has(role);
  }

  get size() {
    return this.cards.size;
  }

  _place(entry) {
    const point = entry.locate ? entry.locate() : entry.point;
    if (!point) return;
    const width = entry.element.offsetWidth;
    const height = entry.element.offsetHeight;
    entry.element.style.left =
      `${Math.max(8, Math.min(point.x + 14, window.innerWidth - width - 8))}px`;
    entry.element.style.top =
      `${Math.max(8, Math.min(point.y + 14, window.innerHeight - height - 8))}px`;
  }

  _build(role, entry) {
    const element = document.createElement('div');
    element.className = 'role-card-host';
    element.dataset.role = role;
    element.appendChild(this.roleInfo.card(role));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'role-card-close';
    close.title = 'Close';
    close.textContent = '×';
    close.addEventListener('click', () => this.drop(role));
    element.appendChild(close);

    element.addEventListener('mouseenter', () => this.hold(role));
    element.addEventListener('mouseleave', () => this.release(role));
    document.body.appendChild(element);

    entry.element = element;
    this._place(entry);
    requestAnimationFrame(() => element.classList.add('on'));
  }

  _ensure(role, point, locate) {
    let entry = this.cards.get(role);
    if (entry) {
      entry.point = point || entry.point;
      if (locate) entry.locate = locate;
      this.hold(role);
      if (entry.element) {
        entry.element.classList.remove('fading');
        entry.element.classList.add('on');
      }
      return entry;
    }
    entry = { element: null, hideTimer: null, frame: null, pinned: false, point, locate };
    this.cards.set(role, entry);
    this.roleInfo.load().then(() => {
      if (this.cards.get(role) !== entry) return;
      this._build(role, entry);
      if (entry.released) this.release(role);
      if (entry.pinned) this._follow(role, entry);
    });
    return entry;
  }

  hold(role) {
    const entry = this.cards.get(role);
    if (!entry) return;
    clearTimeout(entry.hideTimer);
    entry.hideTimer = null;
    entry.released = false;
    if (entry.element) entry.element.classList.remove('fading');
  }

  release(role) {
    const entry = this.cards.get(role);
    if (!entry || entry.pinned) return;
    entry.released = true;
    if (!entry.element) return;
    clearTimeout(entry.hideTimer);
    entry.hideTimer = setTimeout(() => {
      entry.element.classList.add('fading');
      entry.element.classList.remove('on');
      entry.hideTimer = setTimeout(() => this.drop(role), RoleCardHost.FADE);
    }, RoleCardHost.LINGER);
  }

  drop(role) {
    const entry = this.cards.get(role);
    if (!entry) return;
    clearTimeout(entry.hideTimer);
    cancelAnimationFrame(entry.frame);
    if (entry.element) entry.element.remove();
    this.cards.delete(role);
  }

  show(role, point) {
    this._ensure(role, point, null);
  }

  _follow(role, entry) {
    const step = () => {
      const current = this.cards.get(role);
      if (!current || !current.pinned || !current.element) return;
      this._place(current);
      current.frame = requestAnimationFrame(step);
    };
    step();
  }

  // Args:
  //   role: the role whose card to pin.
  //   locate: returns the node's current screen point, polled every frame
  //     because the simulation keeps moving it.
  pin(role, locate) {
    const entry = this._ensure(role, null, locate);
    entry.pinned = true;
    entry.locate = locate;
    clearTimeout(entry.hideTimer);
    entry.hideTimer = null;
    if (entry.element) {
      entry.element.classList.add('pinned', 'on');
      entry.element.classList.remove('fading');
      this._follow(role, entry);
    }
  }

  unpin(role) {
    const roles = role ? [role] : [...this.cards.keys()];
    for (const name of roles) {
      const entry = this.cards.get(name);
      if (!entry || !entry.pinned) continue;
      entry.pinned = false;
      cancelAnimationFrame(entry.frame);
      if (entry.element) entry.element.classList.remove('pinned');
      this.release(name);
    }
  }

  bind(container) {
    container.addEventListener('mouseover', event => {
      const trigger = event.target.closest('[data-role-name]');
      if (!trigger) return;
      this.show(trigger.dataset.roleName, { x: event.clientX, y: event.clientY });
    });
    container.addEventListener('mouseout', event => {
      const trigger = event.target.closest('[data-role-name]');
      if (trigger) this.release(trigger.dataset.roleName);
    });
  }
}

window.RoleInfo = RoleInfo;
window.RoleCardHost = RoleCardHost;
