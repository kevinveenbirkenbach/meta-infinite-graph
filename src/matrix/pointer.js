import { MatrixTable } from './table.js';

export class MatrixPointer {
  // Native drag and drop picked a neighbouring heading as its source inside
  // the sticky header, so a press is followed by hand: released in place it
  // sorts, moved past a few pixels it carries the column to where it is let go.
  static press(matrix, event, id) {
    if (event.button !== 0 || event.target.closest('.matrix-more, .matrix-resize, .matrix-unfold')) {
      return;
    }
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const under = at => {
      const hit = document.elementFromPoint(at.clientX, at.clientY);
      const cell = hit && hit.closest('table.role-matrix tr.matrix-keys th');
      return cell instanceof HTMLElement ? cell : null;
    };
    const clear = () => {
      for (const cell of document.querySelectorAll('.matrix-drop')) cell.classList.remove('matrix-drop');
    };
    const step = moved => {
      if (!dragging && id !== 'role'
        && Math.abs(moved.clientX - start.x) + Math.abs(moved.clientY - start.y) > 6) {
        dragging = true;
        document.body.classList.add('matrix-dragging');
      }
      if (!dragging) return;
      clear();
      const target = under(moved);
      if (target && target.dataset.column !== id) target.classList.add('matrix-drop');
    };
    const release = up => {
      document.removeEventListener('mousemove', step);
      document.removeEventListener('mouseup', release);
      document.body.classList.remove('matrix-dragging');
      clear();
      if (!dragging) {
        matrix.sortBy(id, up.shiftKey);
        return;
      }
      const target = under(up);
      if (target && target.dataset.column && target.dataset.column !== id) {
        matrix.move(id, target.dataset.column);
      }
    };
    document.addEventListener('mousemove', step);
    document.addEventListener('mouseup', release);
  }

  static widen(matrix, event, id, th) {
    event.preventDefault();
    event.stopPropagation();
    const table = th.closest('table');
    const col = table.querySelector(`col[data-column="${CSS.escape(id)}"]`);
    const start = event.clientX;
    const width = parseFloat(col.style.width);
    const step = moved => {
      matrix.widths[id] = Math.max(60, Math.round(width + moved.clientX - start));
      col.style.width = `${matrix.widths[id]}px`;
      MatrixTable.fit(table);
    };
    const stop = () => {
      document.removeEventListener('mousemove', step);
      document.removeEventListener('mouseup', stop);
      matrix.saveWidths();
    };
    document.addEventListener('mousemove', step);
    document.addEventListener('mouseup', stop);
  }
}
