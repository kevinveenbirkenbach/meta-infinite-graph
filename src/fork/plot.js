import { ForkGraph } from './graph.js';

export class ForkPlot {
  static NS = 'http://www.w3.org/2000/svg';

  static ROW = 26;

  static COLUMN = 9;

  static PAD = { left: 190, right: 12, top: 22, bottom: 8 };

  static TAG_GAP = 42;

  static _el(name, attrs) {
    const node = document.createElementNS(ForkPlot.NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  // Args:
  //   graph: a ForkGraph over the fetched repositories.
  //   width: the pixel width to lay the time axis out in.
  //   onPick: called with a commit when its dot is hovered.
  static draw(graph, width, onPick) {
    const span = graph.span();
    const rows = graph.rows();
    if (!span || !rows.length) return null;

    const heights = rows.map(row => ForkPlot.ROW + Math.max(0, row.columns.length - 1) * ForkPlot.COLUMN);
    const top = [];
    let offset = ForkPlot.PAD.top;
    for (const height of heights) {
      top.push(offset);
      offset += height;
    }
    const height = offset + ForkPlot.PAD.bottom;
    const left = ForkPlot.PAD.left;
    const inner = Math.max(120, width - left - ForkPlot.PAD.right);
    // Clamped, so a repository whose life predates the window still shows the
    // part of its line that falls inside it instead of drawing off-canvas.
    const x = at => left + Math.min(1, Math.max(0, (at - span.from) / (span.to - span.from))) * inner;

    const svg = ForkPlot._el('svg', {
      class: 'fork-plot', width, height, viewBox: `0 0 ${width} ${height}`,
    });
    svg.appendChild(ForkPlot._axis(span, x, height));

    const rowOf = new Map(rows.map((row, index) => [row.id, index]));
    const trunkY = index => top[index] + ForkPlot.ROW / 2;

    for (const edge of ForkGraph.forks(rows)) {
      const from = trunkY(rowOf.get(edge.from));
      const to = trunkY(rowOf.get(edge.to));
      const at = x(edge.at);
      svg.appendChild(ForkPlot._el('path', {
        class: 'fork-edge',
        d: `M ${at} ${from} C ${at} ${(from + to) / 2}, ${at} ${(from + to) / 2}, ${at} ${to}`,
      }));
    }

    rows.forEach((row, index) => {
      svg.appendChild(ForkPlot._row(row, index, top, x, onPick));
      const label = ForkPlot._el('text', {
        class: `fork-label${row.parent ? '' : ' root'}`, x: 4, y: trunkY(index) + 3,
      });
      label.textContent = ForkPlot._short(row.id);
      const title = ForkPlot._el('title');
      title.textContent = row.id;
      label.appendChild(title);
      svg.appendChild(label);
    });
    return { svg, rows, height };
  }

  static _short(fullName) {
    if (fullName.length <= 28) return fullName;
    const [owner, name] = fullName.split('/');
    return `${owner.slice(0, 14)}…/${name.slice(0, 12)}`;
  }

  static _axis(span, x, height) {
    const group = ForkPlot._el('g', { class: 'fork-axis' });
    const days = (span.to - span.from) / 86400000;
    const marks = days > 700 ? ForkPlot._years(span) : ForkPlot._months(span);
    for (const { at, text } of marks) {
      const px = x(at);
      group.appendChild(ForkPlot._el('line', { x1: px, x2: px, y1: 14, y2: height }));
      const label = ForkPlot._el('text', { x: px + 3, y: 11 });
      label.textContent = text;
      group.appendChild(label);
    }
    return group;
  }

  static _years(span) {
    const marks = [];
    for (let year = new Date(span.from).getUTCFullYear(); year <= new Date(span.to).getUTCFullYear(); year += 1) {
      const at = Date.UTC(year, 0, 1);
      if (at >= span.from && at <= span.to) marks.push({ at, text: String(year) });
    }
    return marks;
  }

  static _months(span) {
    const marks = [];
    const start = new Date(span.from);
    for (let step = 0; step < 40; step += 1) {
      const at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + step, 1);
      if (at > span.to) break;
      if (at >= span.from) {
        marks.push({ at, text: new Date(at).toISOString().slice(0, 7) });
      }
    }
    return marks;
  }

  static _row(row, index, top, x, onPick) {
    const group = ForkPlot._el('g', { class: 'fork-row' });
    const y = top[index] + ForkPlot.ROW / 2;

    // A fork whose last push predates its creation is real GitHub data, so the
    // life line is clamped rather than drawn backwards.
    const from = x(row.from);
    const to = Math.max(from, x(row.to));
    group.appendChild(ForkPlot._el('line', {
      class: 'fork-life', x1: from, x2: to, y1: y, y2: y,
    }));
    group.appendChild(ForkPlot._el('circle', { class: 'fork-birth', cx: from, cy: y, r: 3 }));

    for (const edge of row.merges || []) {
      const lane = y + edge.from * ForkPlot.COLUMN;
      const at = x(edge.at);
      group.appendChild(ForkPlot._el('path', {
        class: 'fork-merge',
        d: `M ${at} ${lane} C ${at - 6} ${lane}, ${at - 6} ${y}, ${at} ${y}`,
      }));
    }

    // Releases cluster, so every mark is drawn but a name only where it does
    // not land on the one before it.
    let named = -Infinity;
    const tags = [...(row.tags || [])].sort(
      (one, other) => ForkGraph._time(one.date) - ForkGraph._time(other.date)
    );
    for (const tag of tags) {
      const at = x(ForkGraph._time(tag.date));
      const mark = ForkPlot._el('line', { class: 'fork-tag', x1: at, x2: at, y1: y - 9, y2: y });
      const hint = ForkPlot._el('title');
      hint.textContent = `${tag.name} (${String(tag.date).slice(0, 10)})`;
      mark.appendChild(hint);
      group.appendChild(mark);
      if (at - named < ForkPlot.TAG_GAP) continue;
      named = at;
      const label = ForkPlot._el('text', { class: 'fork-tag-name', x: at + 2, y: y - 10 });
      label.textContent = tag.name;
      group.appendChild(label);
    }

    for (const column of row.columns || []) {
      const lane = y + column.column * ForkPlot.COLUMN;
      if (column.from !== null && column.to !== null) {
        group.appendChild(ForkPlot._el('line', {
          class: 'fork-lane', x1: x(column.from), x2: x(column.to), y1: lane, y2: lane,
        }));
      }
      for (const commit of column.commits) {
        const dot = ForkPlot._el('circle', {
          class: `fork-commit${(commit.parents || []).length > 1 ? ' merge' : ''}`,
          cx: x(ForkGraph._time(commit.date)), cy: lane, r: 2.4,
        });
        dot.addEventListener('mouseover', event => onPick(commit, row, event));
        dot.addEventListener('mouseout', () => onPick(null, row));
        group.appendChild(dot);
      }
    }
    return group;
  }
}
