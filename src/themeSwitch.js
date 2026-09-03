// Loaded from <head> so the attribute is set before the first paint.
(() => {
  const KEY = 'mig-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const stored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };

  const apply = theme => {
    document.documentElement.dataset.bsTheme = theme;
  };

  const fromSystem = () => (media.matches ? 'dark' : 'light');

  // Args:
  //   choice: 'system', 'light' or 'dark'. 'system' drops the stored choice
  //     so the page follows the media query again.
  const choose = choice => {
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // A blocked store only costs the choice its persistence.
    }
    apply(choice === 'system' ? fromSystem() : choice);
  };

  apply(stored() || fromSystem());
  media.addEventListener('change', () => {
    if (!stored()) apply(fromSystem());
  });

  window.MigTheme = { choose, stored, apply };
})();
