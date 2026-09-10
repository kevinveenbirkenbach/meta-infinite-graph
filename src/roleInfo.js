class RoleInfo {
  constructor(dataLoader, metaGraph, tables) {
    this.loader = dataLoader;
    this.graph = metaGraph;
    this.tables = tables;
    this.info = {};
    this.brands = {};
    this.symbols = false;
    this.resources = true;
    this.footprint = new RoleResources(tables, (key, role) => this.serviceChip(key, role));
    this._promise = null;
  }

  // Args:
  //   key: a service key as meta/services.yml spells it.
  //   fallback: the role to open when no role provides the key under that name.
  // Returns: a chip that opens the providing role's card on hover.
  serviceChip(key, fallback = null) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = key;
    const provider = (this.tables && this.tables.providerOf(key)) || fallback;
    if (provider) {
      chip.classList.add('service');
      chip.dataset.roleName = provider;
      chip.title = `provided by ${provider}`;
    }
    return chip;
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
    for (const [name, items, chip] of [
      ['Services', attributes.services || [], item => this.serviceChip(item)],
      ['Tags', attributes.galaxy_tags || [], item => Object.assign(
        document.createElement('span'), { className: 'chip', textContent: item }
      )],
    ]) {
      if (!items.length) continue;
      const term = document.createElement('dt');
      term.textContent = name;
      const definition = document.createElement('dd');
      definition.className = 'chips';
      for (const item of items) definition.appendChild(chip(item));
      facts.append(term, definition);
    }
    if (this.resources) facts.append(...this.footprint.facts(role));
    if (facts.childElementCount) card.appendChild(facts);

    const resources = this.resources ? this.footprint.table(role) : null;
    if (resources) card.appendChild(resources);

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

window.RoleInfo = RoleInfo;
