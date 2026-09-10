import { byId } from '../dom.js';
import { urlState } from '../context.js';
import { ForkCards } from '../fork/cards.js';
import { ForkTree } from '../fork/tree.js';
import { currentView } from './views.js';

export function wireForks(forkTree, cardHost) {
  const root = byId('fork-root', HTMLInputElement);
  const token = byId('fork-token', HTMLInputElement);
  const forget = byId('fork-forget', HTMLButtonElement);
  const owned = document.getElementById('fork-token-owned');
  const field = document.querySelector('.token-field');

  // Left of the panel rather than at the pointer: the panel is the right edge
  // of the window, so a card at the pointer covers the very input to fill in.
  const help = () => {
    const box = field.getBoundingClientRect();
    cardHost.show(
      ForkCards.TOKEN_HELP,
      { x: box.left, y: box.top, flip: true },
      ForkCards.tokenHelp
    );
  };
  field.addEventListener('mouseover', help);
  field.addEventListener('focusin', help);
  field.addEventListener('mouseout', () => cardHost.release(ForkCards.TOKEN_HELP));
  field.addEventListener('focusout', () => cardHost.release(ForkCards.TOKEN_HELP));

  root.value = forkTree.root;
  token.value = forkTree.api.token;

  forkTree.api.detectProxy().then(proxied => {
    for (const element of document.querySelectorAll('.token-field')) {
      element.toggleAttribute('hidden', proxied);
    }
    owned.hidden = !proxied;
    if (proxied) {
      forkTree.api.token = '';
      token.value = '';
    }
  });

  root.addEventListener('change', () => {
    if (!ForkTree.isRepo(root.value.trim())) {
      root.value = forkTree.root;
      return;
    }
    forkTree.setRoot(root.value.trim());
    urlState.capture();
    if (currentView() === 'forks') forkTree.show();
  });

  token.addEventListener('change', () => {
    forkTree.api.token = token.value.trim();
    forkTree.loaded = null;
    if (currentView() === 'forks') forkTree.show();
  });

  forget.addEventListener('click', () => {
    forkTree.api.forget();
    forkTree.api.token = '';
    token.value = '';
    forkTree.loaded = null;
    if (currentView() === 'forks') forkTree.show();
  });
}
