import { chrome, hideLater, waiting } from '../popup.js';

export class RoleCardHost {
  constructor(roleInfo) {
    this.roleInfo = roleInfo;
    this.cards = new Map();
    this.waits = waiting();
  }

  has(role) {
    return this.cards.has(role);
  }

  get size() {
    return this.cards.size;
  }

  // The pointer must stay outside the card, or the card holds itself open and
  // covers whatever the pointer moves to next.
  static GAP = 5;

  _place(entry) {
    const point = entry.locate ? entry.locate() : entry.point;
    if (!point) return;
    const width = entry.element.offsetWidth;
    const height = entry.element.offsetHeight;
    const left = point.flip ? point.x - width - RoleCardHost.GAP : point.x + RoleCardHost.GAP;
    entry.element.style.left =
      `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    entry.element.style.top =
      `${Math.max(8, Math.min(point.y + RoleCardHost.GAP, window.innerHeight - height - 8))}px`;
  }

  _build(role, entry) {
    const element = document.createElement('div');
    element.className = 'role-card-host popup-fade';
    element.dataset.role = role;
    element.appendChild(entry.build ? entry.build() : this.roleInfo.card(role));

    entry.chrome = chrome(element, {
      onClose: () => this.drop(role),
      onState: state => {
        if (state) this.hold(role);
        else this._place(entry);
      },
    });

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
      // Moving inside the trigger fires mouseover again; the card stays where
      // the pointer first opened it rather than crawling after it.
      entry.point = entry.point || point;
      if (locate) entry.locate = locate;
      this.hold(role);
      if (entry.element) {
        entry.element.classList.remove('fading');
        entry.element.classList.add('on');
      }
      return entry;
    }
    entry = { element: null, hide: null, chrome: null, frame: null, pinned: false, point, locate, build };
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
    if (entry.hide) entry.hide.cancel();
    entry.hide = null;
    entry.released = false;
    if (entry.element) entry.element.classList.remove('fading');
  }

  // A maximized card covers the window, so the pointer leaving it means it left
  // the page, not the card; letting that fade it would close it under the reader.
  release(role) {
    this.waits.cancel(role);
    const entry = this.cards.get(role);
    if (!entry || entry.pinned || (entry.chrome && entry.chrome.state)) return;
    entry.released = true;
    if (!entry.element) return;
    if (entry.hide) entry.hide.cancel();
    entry.hide = hideLater(entry.element, () => this.drop(role));
  }

  drop(role) {
    this.waits.cancel(role);
    const entry = this.cards.get(role);
    if (!entry) return;
    if (entry.hide) entry.hide.cancel();
    cancelAnimationFrame(entry.frame);
    if (entry.element) entry.element.remove();
    this.cards.delete(role);
  }

  // Args:
  //   now: true opens at once, for a click or the keyboard; a pointer resting
  //     on the trigger waits POPUP.DELAY, so passing over it opens nothing.
  show(role, point, build, now = false) {
    if (now || this.cards.has(role)) {
      this.waits.cancel(role);
      this._ensure(role, point, null, build);
      return;
    }
    this.waits.arm(role, () => this._ensure(role, point, null, build));
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
    if (entry.hide) entry.hide.cancel();
    entry.hide = null;
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
    const at = event => ({ x: event.clientX, y: event.clientY });
    container.addEventListener('mouseover', event => {
      const trigger = event.target.closest('[data-role-name]');
      if (!trigger) return;
      this.show(trigger.dataset.roleName, at(event));
    });
    container.addEventListener('click', event => {
      const trigger = event.target.closest('[data-role-name]');
      if (trigger) this.show(trigger.dataset.roleName, at(event), null, true);
    });
    container.addEventListener('mouseout', event => {
      const trigger = event.target.closest('[data-role-name]');
      if (trigger) this.release(trigger.dataset.roleName);
    });
  }
}
