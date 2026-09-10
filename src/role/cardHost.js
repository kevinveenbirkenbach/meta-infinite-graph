import { t } from '../i18n.js';
export class RoleCardHost {
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
    const left = point.flip ? point.x - width - 14 : point.x + 14;
    entry.element.style.left =
      `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    entry.element.style.top =
      `${Math.max(8, Math.min(point.y + 14, window.innerHeight - height - 8))}px`;
  }

  _build(role, entry) {
    const element = document.createElement('div');
    element.className = 'role-card-host';
    element.dataset.role = role;
    element.appendChild(entry.build ? entry.build() : this.roleInfo.card(role));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'role-card-close';
    close.title = t('card.close');
    close.textContent = '×';
    close.addEventListener('click', () => this.drop(role));
    element.appendChild(close);

    if (!entry.build) {
      const grow = document.createElement('button');
      grow.type = 'button';
      grow.className = 'role-card-grow';
      grow.title = t('card.maximize');
      grow.textContent = '⤢';
      grow.addEventListener('click', () => this.maximize(role));
      element.appendChild(grow);
    }

    element.addEventListener('mouseenter', () => this.hold(role));
    element.addEventListener('mouseleave', () => this.release(role));
    document.body.appendChild(element);

    entry.element = element;
    this._place(entry);
    requestAnimationFrame(() => element.classList.add('on'));
  }

  _ensure(role, point, locate, build) {
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
    entry = { element: null, hideTimer: null, frame: null, pinned: false, point, locate, build };
    this.cards.set(role, entry);
    if (build) {
      this._build(role, entry);
      return entry;
    }
    this.roleInfo.load().then(() => {
      if (this.cards.get(role) !== entry) return;
      this._build(role, entry);
      if (entry.released) this.release(role);
      if (entry.pinned) {
        entry.element.classList.add('pinned', 'on');
        this._follow(role, entry);
      }
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

  maximize(role) {
    const entry = this.cards.get(role);
    if (!entry || !entry.element) return;
    entry.maximized = !entry.maximized;
    entry.element.classList.toggle('maximized', entry.maximized);
    const grow = entry.element.querySelector('.role-card-grow');
    grow.textContent = entry.maximized ? '⤡' : '⤢';
    grow.title = t(entry.maximized ? 'card.restore' : 'card.maximize');
    if (entry.maximized) this.hold(role);
    else this._place(entry);
  }

  // A maximized card covers the window, so the pointer leaving it means it left
  // the page, not the card; letting that fade it would close it under the reader.
  release(role) {
    const entry = this.cards.get(role);
    if (!entry || entry.pinned || entry.maximized) return;
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

  show(role, point, build) {
    this._ensure(role, point, null, build);
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
