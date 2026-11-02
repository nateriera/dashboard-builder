// Chart composites keep normalized field keys. Source presentation follows
// their object identity, so filtering/sorting never changes the row pairing.
const sources = new WeakMap();
export function retainSourceRows(rows, sourceRows) {
  if (Array.isArray(sourceRows) && sourceRows.length === rows.length) {
    rows.forEach((row, index) => sources.set(row, sourceRows[index]));
  }
  return rows;
}
export function sourceRowsFor(rows) {
  if (!rows.some(row => sources.has(row))) return rows;
  return rows.map(row => sources.get(row) || row);
}
