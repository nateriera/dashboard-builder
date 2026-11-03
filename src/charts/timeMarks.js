import { calendarDate } from '../data/filters.js';

// Plot supplies the actual rendered indexes after channel filtering. Bind
// each mark to its composite row, whose IV-A source provenance stays intact.
const markRows = new WeakMap();
export function timeMarkRender(plottedRows, sourceRows = plottedRows, field = 'date') {
  return (index, scales, values, dimensions, context, next) => {
    const group = next(index, scales, values, dimensions, context);
    [...group.querySelectorAll('circle')].forEach((circle, position) => {
      const i = index[position], row = sourceRows[i];
      if (row) markRows.set(circle, { row, time: new Date(plottedRows[i][field]).getTime() });
    });
    return group;
  };
}

export function timeBrushPoints(svg) {
  return [...svg.querySelectorAll('g[aria-label="dot"] circle')].flatMap(circle => {
    const linked = markRows.get(circle), x = Number(circle.getAttribute('cx'));
    return linked && Number.isFinite(x) && Number.isFinite(linked.time) ? [{ x, ...linked }] : [];
  }).sort((a,b) => a.x - b.x);
}

export function timeBrushSelection(points, startX, endX, field = 'date') {
  const left = Math.min(startX,endX), right = Math.max(startX,endX);
  const markValues = [...new Set(points.filter(point => point.x >= left && point.x <= right).map(point => point.row[field]))];
  if (!markValues.length) return null;
  const dates = markValues.map(calendarDate).sort();
  if (dates.some(date => date === null)) return null;
  return { values: [dates[0], dates.at(-1)], markValues };
}
