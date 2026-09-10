import { graphRenderer } from '../context.js';
import { byId, el } from '../dom.js';

export function wireGraphCards(cardHost) {
  cardHost.bind(document.body);
  const at = node => {
    const point = graphRenderer.graph.graph2ScreenCoords(node.x, node.y, node.z);
    return point ? { x: point.x, y: point.y } : null;
  };
  graphRenderer.on('nodeClicked', ({ node }) => cardHost.pin(node.id, () => at(node)));
  graphRenderer.on('backgroundClicked', () => cardHost.unpin());
  let hoveredNode = null;
  graphRenderer.on('nodeHovered', ({ node }) => {
    if (hoveredNode && hoveredNode !== node?.id) cardHost.release(hoveredNode);
    hoveredNode = node ? node.id : null;
    if (!node) return;
    cardHost.show(node.id, at(node) || { x: 20, y: 80 });
  });
}

// Heaviest role first, so the dropdown and the default start node both open
// on the busiest hub of the graph.
export function wireRoleSelect(metaGraph) {
  const ranked = metaGraph.rolesByWeight();
  const sel = byId('sel-role', HTMLSelectElement);
  const fill = list => {
    sel.innerHTML = '';
    for (const role of list) {
      sel.appendChild(el('option', { value: role, textContent: `${role} (${metaGraph.weight(role)})` }));
    }
  };
  fill(ranked);
  const search = byId('role-search', HTMLInputElement);
  search.addEventListener('input', () => {
    const filter = search.value.toLowerCase();
    fill(ranked.filter(role => role.toLowerCase().includes(filter)));
  });
  return { sel, ranked };
}
