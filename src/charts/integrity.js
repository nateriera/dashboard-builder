import { LIMITS } from '../data/limits.js';

export function donutParts(rows, label = 'label', value = 'value', max = 6) {
  const groups = new Map();
  for (const row of rows) {
    const v = row[value];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('Donut charts require finite, nonnegative values. Use a bar chart for signed data.');
    const k = String(row[label] ?? 'Unlabeled');
    groups.set(k, (groups.get(k) || 0) + v);
  }
  const parts = [...groups].map(([k,v]) => ({ [label]: k, [value]: v })).sort((a,b) => b[value] - a[value] || a[label].localeCompare(b[label]));
  const total = parts.reduce((s,r) => s + r[value], 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Donut charts require a positive total.');
  if (parts.length <= max) return parts;
  const kept = parts.slice(0, max - 1);
  let other = 'Other (remaining categories)';
  while (groups.has(other)) other += ' — grouped';
  kept.push({ [label]: other, [value]: parts.slice(max - 1).reduce((s,r) => s + r[value], 0) });
  return kept;
}

export function renderData(type, rows) {
  if (type === 'donut') return { rows: donutParts(rows), note: rows.length > 6 ? 'Duplicate categories combined; largest five and Other shown. All contributions retained.' : '' };
  if (type === 'table' && rows.length > LIMITS.tableRows) return {
    rows: rows.slice(0, LIMITS.tableRows),
    note: `Table is showing first ${LIMITS.tableRows.toLocaleString()} of ${rows.length.toLocaleString()} rows. All rows remain in the source data.`
  };
  if (['stackedBar','stackedColumn','boxplot','treemap'].includes(type)) {
    const categories = new Set(rows.map(r => r.label));
    if (categories.size > LIMITS.categories) throw new Error(`This chart supports ${LIMITS.categories} categories. Aggregate or filter before plotting; no rows were silently omitted.`);
  }
  if (type === 'heatmap') {
    const cells = new Set();
    for (const row of rows) {
      const key = JSON.stringify([String(row.x), String(row.y)]);
      if (cells.has(key)) throw new Error('Heatmap input has duplicate x/y cells. Aggregate duplicate coordinates in SQL before plotting.');
      cells.add(key);
      if (cells.size > LIMITS.heatmapCells) throw new Error(`Heatmap limit is ${LIMITS.heatmapCells.toLocaleString()} distinct cells. Aggregate or filter in SQL before plotting.`);
    }
  }
  if (type === 'treemap') {
    if (rows.some(r => typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0)) throw new Error('Treemap values must be finite, nonnegative numbers.');
    if (rows.reduce((sum,row) => sum + row.value,0) <= 0) throw new Error('Treemap values must have a positive total.');
  }
  if (type === 'smallMultiples' && new Set(rows.map(r => r.facet)).size > LIMITS.facets) throw new Error(`Facet limit is ${LIMITS.facets}. Filter or aggregate your data.`);
  if (['bar','column','dot','smallMultiples','kpi'].includes(type)) {
    if (rows.length > LIMITS.categories) throw new Error(`This chart supports ${LIMITS.categories} rows. Aggregate or filter before plotting; no rows were silently omitted.`);
  }
  if (['line','scatter','histogram','area'].includes(type) && rows.length > LIMITS.marks) {
    const sampled = Array.from({ length: LIMITS.marks }, (_,i) => rows[Math.floor(i * (rows.length - 1) / (LIMITS.marks - 1))]);
    return { rows: sampled, note: `Plot shows ${LIMITS.marks.toLocaleString()} evenly spaced rows of ${rows.length.toLocaleString()}. Underlying data is retained; use SQL aggregation for authoritative trends.` };
  }
  return { rows, note: '' };
}
