import { t } from './i18n.js';

// DELAY: how long a pointer rests on a trigger before its popup opens.
// LINGER: how long a popup stays after the pointer leaves. FADE: the fade out.
export const POPUP = { DELAY: 300, LINGER: 500, FADE: 500 };

const MARKS = {
  minimize: ['−', '+'],
  maximize: ['⤢', '⤡'],
};

const TITLES = {
  minimize: ['card.minimize', 'card.restore'],
  maximize: ['card.maximize', 'card.restore'],
};

function button(kind, mark, title, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `popup-button popup-${kind}`;
  element.textContent = mark;
  element.title = title;
  element.setAttribute('aria-label', title);
  element.addEventListener('click', event => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

// Args:
//   element: the popup's window, which carries the state classes.
//   onClose: called when the close button is pressed.
//   onState: called after a minimize or maximize, for a caller that has to
//     replace the popup or stop hiding it.
// Returns: { element, state, set } where state is '', 'minimized' or
//   'maximized' and set(state) applies one from outside.
/**
 * @param {HTMLElement} element
 * @param {{ onClose?: () => void, onState?: (state: string) => void }} handlers
 */
export function chrome(element, { onClose = () => {}, onState = () => {} } = {}) {
  const bar = document.createElement('div');
  bar.className = 'popup-chrome';
  const state = { value: '' };

  const paint = () => {
    for (const kind of ['minimize', 'maximize']) {
      const held = state.value === `${kind}d`;
      const control = /** @type {HTMLButtonElement} */ (bar.querySelector(`.popup-${kind}`));
      control.textContent = MARKS[kind][held ? 1 : 0];
      control.title = t(TITLES[kind][held ? 1 : 0]);
      control.setAttribute('aria-label', control.title);
      control.setAttribute('aria-pressed', String(held));
    }
    element.classList.toggle('popup-minimized', state.value === 'minimized');
    element.classList.toggle('popup-maximized', state.value === 'maximized');
  };
  const toggle = kind => {
    state.value = state.value === `${kind}d` ? '' : `${kind}d`;
    paint();
    onState(state.value);
  };

  bar.appendChild(button('minimize', MARKS.minimize[0], t(TITLES.minimize[0]), () => toggle('minimize')));
  bar.appendChild(button('maximize', MARKS.maximize[0], t(TITLES.maximize[0]), () => toggle('maximize')));
  bar.appendChild(button('close', '×', t('card.close'), onClose));
  element.appendChild(bar);
  element.classList.add('popup');
  paint();

  return {
    element: bar,
    get state() {
      return state.value;
    },
    set(value) {
      state.value = value;
      paint();
    },
  };
}

// Args:
//   element: the popup to fade, which gets 'fading' and loses 'on'.
//   drop: called once the fade is over, to take the popup off the page.
// Returns: a handle whose cancel() stops whichever half is still pending.
export function hideLater(element, drop) {
  let timer = setTimeout(() => {
    element.classList.add('fading');
    element.classList.remove('on');
    timer = setTimeout(drop, POPUP.FADE);
  }, POPUP.LINGER);
  return {
    cancel() {
      clearTimeout(timer);
      element.classList.remove('fading');
    },
  };
}

// Args:
//   run: opens the popup, once the pointer has rested POPUP.DELAY on the
//     trigger. A second arm for the same key replaces the first.
// Returns: { arm, cancel, held } over the waits still running.
export function waiting() {
  const timers = new Map();
  return {
    arm(key, run) {
      if (timers.has(key)) return;
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        run();
      }, POPUP.DELAY));
    },
    cancel(key) {
      clearTimeout(timers.get(key));
      timers.delete(key);
    },
    held(key) {
      return timers.has(key);
    },
  };
}

// Args:
//   close: called on Escape, whatever holds the focus.
// Returns: the function that stops listening again.
export function onEscape(close) {
  const listener = event => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', listener, true);
  return () => document.removeEventListener('keydown', listener, true);
}
