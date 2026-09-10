// Args:
//   tag: the element to create.
//   props: assigned onto it as they are, so every value has to be meant.
// Returns: the element.
function el(tag, props) {
  return Object.assign(document.createElement(tag), props);
}

// Args:
//   className: left off when empty, where el() would write the string
//     "undefined" into the attribute.
function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

window.el = el;
window.textElement = textElement;
