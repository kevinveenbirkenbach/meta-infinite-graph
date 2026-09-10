const STORE = 'mig-language';

const ALIASES = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', mo: 'ro', fil: 'tl', sh: 'sr' };

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/** @type {{ code: string, name: string, dir?: string }[]} */
export const LANGUAGES = await fetchJson('locales/index.json');
const CODES = new Set(LANGUAGES.map(entry => entry.code));

function stored() {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

/**
 * @param {readonly string[]} preferred  the browser's languages, most wanted first.
 * @returns {string} the stored choice when there is one, else the first
 *   preferred language with a catalogue, else English.
 */
export function detect(preferred) {
  const choice = stored();
  if (choice && CODES.has(choice)) return choice;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const code = ALIASES[base] || base;
    if (CODES.has(code)) return code;
  }
  return 'en';
}

export const language = detect(navigator.languages || [navigator.language]);
export const choice = stored() || 'auto';

const [english, own] = await Promise.all([
  fetchJson('locales/en.json'),
  language === 'en' ? null : fetchJson(`locales/${language}.json`),
]);
const messages = { ...english, ...own };
const plurals = new Intl.PluralRules(language);

/**
 * @param {string} key  a key of locales/en.json.
 * @param {Record<string, unknown>} [params]  values for its {placeholders};
 *   params.n also picks the plural form when the message has several.
 * @returns {string}
 */
export function t(key, params = {}) {
  let message = messages[key];
  if (message === undefined) throw new Error(`locales/en.json has no key ${key}`);
  if (typeof message === 'object') message = message[plurals.select(Number(params.n))] ?? message.other;
  return message.replace(/\{(\w+)\}/g, (all, name) => (name in params ? String(params[name]) : all));
}

export function localize(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const [attribute, property] of [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder']]) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      element.setAttribute(property, t(element.getAttribute(attribute)));
    }
  }
}

export function choose(code) {
  try {
    if (code === 'auto') localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, code);
  } catch {
    return;
  }
  window.location.reload();
}

const entry = LANGUAGES.find(candidate => candidate.code === language);
document.documentElement.lang = language;
document.documentElement.dir = entry.dir || 'ltr';
if (entry.dir === 'rtl') {
  const bootstrap = document.querySelector('link[href="vendor/bootstrap.min.css"]');
  if (bootstrap) bootstrap.setAttribute('href', 'vendor/bootstrap.rtl.min.css');
}
localize(document);
