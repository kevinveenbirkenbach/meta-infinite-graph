import { el } from '../dom.js';
import { html, render, toElement } from '../html.js';
import { RoleResources } from './resources.js';

export class RoleInfo {
  constructor(dataLoader, metaGraph, tables) {
    this.loader = dataLoader;
    this.graph = metaGraph;
    this.tables = tables;
    this.info = {};
    this.brands = {};
    this.symbols = false;
    this.resources = true;
    this.footprint = new RoleResources(tables, (key, role) => this.chip(key, role));
    this._promise = null;
  }

  // Args:
  //   key: a service key as meta/services.yml spells it.
  //   fallback: the role to open when no role provides the key under that name.
  // Returns: a chip that opens the providing role's card on hover.
  chip(key, fallback = null) {
    const provider = (this.tables && this.tables.providerOf(key)) || fallback;
    return provider
      ? html`<span class="chip service" data-role-name=${provider} title=${`provided by ${provider}`}>${key}</span>`
      : html`<span class="chip">${key}</span>`;
  }

  serviceChip(key, fallback = null) {
    return toElement(this.chip(key, fallback));
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

  icon(role) {
    const slug = this.brands[role];
    if (slug) return html`<img class="role-icon" src=${`vendor/simple-icons/${slug}.svg`} alt=${role} />`;
    const declared = this.info[role]?.logo?.class;
    return html`<i class=${`role-icon ${declared || 'fa-regular fa-circle'}`}></i>`;
  }

  iconFor(role) {
    return toElement(this.icon(role));
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

  // YouTube authorises an embed by its referrer and answers "error 153"
  // without one, so the policy has to leave at least the origin in place.
  static player(video) {
    const embed = RoleInfo.embedUrl(video);
    if (!embed) return null;
    return html`<iframe class="role-card-video" src=${embed} loading="lazy" allowfullscreen
      allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
      referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  labelNode(role) {
    return this.symbols ? this.icon(role) : html`<span>${role}</span>`;
  }

  label(role) {
    return toElement(this.labelNode(role));
  }

  card(role) {
    const root = el('div', { className: 'role-card' });
    render(html`<${RoleCard} info=${this} role=${role} />`, root);
    return root;
  }
}

function RoleCard({ info: roleInfo, role }) {
  const info = roleInfo.info[role] || {};
  const attributes = roleInfo.graph.attributes[role] || {};
  const scalars = [
    ['Weight', String(roleInfo.graph.weight(role))],
    ['Provides', attributes.provides],
    ['Modes', (attributes.modes || []).join(', ')],
    ['Author', attributes.author],
    ['License', attributes.license],
  ].filter(([, value]) => value);
  const lists = [
    ['Services', attributes.services || [], item => roleInfo.chip(item)],
    ['Tags', attributes.galaxy_tags || [], item => html`<span class="chip">${item}</span>`],
  ].filter(([, items]) => items.length);
  const footprint = roleInfo.resources ? roleInfo.footprint.facts(role) : [];
  const player = info.video ? RoleInfo.player(info.video) : null;
  const links = [
    ['Homepage', info.homepage],
    ...(info.video ? [[player ? 'Watch on site' : 'Video', info.video]] : []),
  ].filter(([, href]) => href);
  return html`
    <div class="role-card-title">
      ${roleInfo.icon(role)}${` ${role}`}
      ${attributes.lifecycle && html`
        <span class=${`role-card-badge lifecycle-${attributes.lifecycle}`}>${attributes.lifecycle}</span>
      `}
    </div>
    ${attributes.description && html`<p class="role-card-desc">${attributes.description}</p>`}
    ${(scalars.length || lists.length || footprint.length) ? html`
      <dl class="role-card-facts">
        ${scalars.map(([name, value]) => html`<dt>${name}</dt><dd>${value}</dd>`)}
        ${lists.map(([name, items, chip]) => html`<dt>${name}</dt><dd class="chips">${items.map(chip)}</dd>`)}
        ${footprint}
      </dl>
    ` : null}
    ${roleInfo.resources ? roleInfo.footprint.table(role) : null}
    ${player}
    ${links.length ? html`
      <div class="role-card-links">
        ${links.map(([text, href]) => html`<a href=${href} target="_blank" rel="noreferrer">${text}</a>`)}
      </div>
    ` : null}
  `;
}
