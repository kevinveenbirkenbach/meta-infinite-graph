// Args:
//   tag: the element to create.
//   props: assigned onto it as they are, so every value has to be meant.
// Returns: the element.
export function el(tag, props) {
  return Object.assign(document.createElement(tag), props);
}

// Args:
//   className: left off when empty, where el() would write the string
//     "undefined" into the attribute.
export function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

/**
 * @template {Element} T
 * @param {Element | null} found
 * @param {{ new (): T }} type  what the element has to be, e.g. HTMLInputElement.
 * @param {string} what  how the error names the lookup.
 * @returns {T}
 */
function must(found, type, what) {
  if (!(found instanceof type)) throw new Error(`${what} is not a ${type.name} in index.html`);
  return found;
}

/**
 * @template {Element} T
 * @param {string} id  an id index.html declares.
 * @param {{ new (): T }} type
 * @returns {T}
 */
export function byId(id, type) {
  return must(document.getElementById(id), type, `#${id}`);
}

/**
 * @template {Element} T
 * @param {string} selector  matched against the whole document, first hit only.
 * @param {{ new (): T }} type
 * @returns {T}
 */
export function bySelector(selector, type) {
  return must(document.querySelector(selector), type, selector);
}
