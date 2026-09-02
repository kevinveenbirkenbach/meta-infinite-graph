// Loaded from <head> so the attribute is set before the first paint; the
// button it labels only exists after DOMContentLoaded.
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
    const button = document.getElementById('btn-theme');
    if (!button) return;
    button.textContent = theme === 'dark' ? '☀️' : '🌙';
    button.title = theme === 'dark' ? 'Switch to day' : 'Switch to night';
  };

  apply(stored() || (media.matches ? 'dark' : 'light'));

  media.addEventListener('change', event => {
    if (!stored()) apply(event.matches ? 'dark' : 'light');
  });

  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.bsTheme);
    document.getElementById('btn-theme').addEventListener('click', () => {
      const next = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // A blocked store only costs the choice its persistence.
      }
      apply(next);
    });
  });
})();
