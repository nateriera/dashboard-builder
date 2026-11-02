// Keep normalization diagnostics out of serializable row data.
const droppedCounts = new WeakMap();
export function withDroppedCount(rows, count) {
  droppedCounts.set(rows, count);
  return rows;
}
export function droppedCount(rows) { return droppedCounts.get(rows) || 0; }
export function blankingNotice(count, kind = 'non-numeric') {
  return `${count.toLocaleString()} ${kind} value${count === 1 ? '' : 's'} blanked`;
}

// Export copies have JSON-safe numbers. A cell present in both the chart
// composite and its source copy is one blanked cell, not two notices.
export function materializeExportRows(rows, sourceRows = rows) {
  const cells = new Set();
  const clean = input => input.map((row, index) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        cells.add(JSON.stringify([index, key]));
        return [key, null];
      }
      return [key, value];
    })
  ));
  const output = clean(rows);
  const source = sourceRows === rows ? output : clean(sourceRows);
  return { rows: output, sourceRows: source, blanked: cells.size };
}
