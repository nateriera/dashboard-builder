// Conservative engineering budgets, not a claim of measured device capacity.
export const LIMITS = Object.freeze({
  fileBytes: 16 * 1024 * 1024, columns: 100, rows: 250000,
  queryRows: 10000, marks: 2000, categories: 100, facets: 12,
  tiles: 100, layoutBytes: 32 * 1024 * 1024
});
export function numericExtent(values, includeZero = false) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  if (lo === Infinity) return [0, 1];
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  return lo === hi ? [Math.min(lo, 0), hi || 1] : [lo, hi];
}
export function assertRows(rows, cap = LIMITS.rows) {
  if (!Array.isArray(rows) || rows.length > cap) throw new Error(`Row limit is ${cap.toLocaleString()}. Reduce the input or aggregate it in SQL.`);
  const columns = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Rows must be objects.');
    for (const [key, v] of Object.entries(row)) {
      if (["__proto__","constructor","prototype"].includes(key)) throw new Error("Reserved column name. Rename the column.");
      columns.add(key);
      if (columns.size > LIMITS.columns) throw new Error(`Column limit is ${LIMITS.columns}. Select fewer columns.`);
      if (v !== null && !['string','number','boolean'].includes(typeof v)) throw new Error('Cells must be text, finite numbers, booleans or null.');
      if (typeof v === 'number' && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw new Error('Unsafe numeric cell: encode large integers as decimal strings.');
    }
  }
}
