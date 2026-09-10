import { byId } from '../dom.js';
import { urlState } from '../context.js';

export function wireDesign(graphRenderer) {
  const root = document.documentElement;
  const families = {
    sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
  const read = key => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A blocked store only costs the choice its persistence.
    }
  };

  const size = byId('design-font-size', HTMLInputElement);
  const family = byId('design-font-family', HTMLSelectElement);
  const veil = byId('design-opacity', HTMLInputElement);
  const theme = byId('design-theme', HTMLSelectElement);
  const zoom = byId('design-zoom', HTMLInputElement);

  const applySize = () => {
    root.style.setProperty('--mig-font-size', `${size.value}px`);
    document.getElementById('design-font-size-value').textContent = size.value;
    write('mig-font-size', size.value);
  };
  const applyFamily = () => {
    root.style.setProperty('--mig-font-family', families[family.value]);
    write('mig-font-family', family.value);
  };
  const applyZoom = () => {
    root.style.setProperty('--mig-zoom', String(Number(zoom.value) / 100));
    document.getElementById('design-zoom-value').textContent = zoom.value;
    write('mig-zoom', zoom.value);
    if (graphRenderer) graphRenderer.setZoom(Number(zoom.value));
  };
  const applyVeil = () => {
    root.style.setProperty('--mig-veil', String(Number(veil.value) / 100));
    document.getElementById('design-opacity-value').textContent = veil.value;
    write('mig-veil', veil.value);
  };

  size.value = read('mig-font-size') || size.value;
  family.value = read('mig-font-family') || family.value;
  veil.value = read('mig-veil') ?? veil.value;
  zoom.value = read('mig-zoom') || zoom.value;
  theme.value = read('mig-theme') || 'system';

  urlState
    .register('theme', () => theme.value, value => {
      theme.value = value;
      window.MigTheme.choose(value);
    }, 'system')
    .register('fontsize', () => size.value, value => {
      size.value = value;
      applySize();
    }, '14')
    .register('font', () => family.value, value => {
      family.value = value;
      applyFamily();
    }, 'sans')
    .register('veil', () => veil.value, value => {
      veil.value = value;
      applyVeil();
    }, '5')
    .register('zoom', () => zoom.value, value => {
      zoom.value = value;
      applyZoom();
    }, '100');

  const remember = handler => () => {
    handler();
    urlState.capture();
  };
  size.addEventListener('input', remember(applySize));
  family.addEventListener('change', remember(applyFamily));
  veil.addEventListener('input', remember(applyVeil));
  zoom.addEventListener('input', remember(applyZoom));
  theme.addEventListener('change', remember(() => window.MigTheme.choose(theme.value)));

  applySize();
  applyFamily();
  applyVeil();
  applyZoom();
  urlState.apply(['theme', 'fontsize', 'font', 'veil', 'zoom']);
}
