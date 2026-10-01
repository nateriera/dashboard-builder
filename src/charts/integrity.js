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
  if (type === 'smallMultiples' && new Set(rows.map(r => r.facet)).size > LIMITS.facets) throw new Error(`Facet limit is ${LIMITS.facets}. Filter or aggregate your data.`);
  if (['bar','column','dot','smallMultiples','kpi'].includes(type)) {
    if (rows.length > LIMITS.categories) throw new Error(`This chart supports ${LIMITS.categories} rows. Aggregate or filter before plotting; no rows were silently omitted.`);
  }
  if (['line','scatter'].includes(type) && rows.length > LIMITS.marks) {
    const sampled = Array.from({ length: LIMITS.marks }, (_,i) => rows[Math.floor(i * (rows.length - 1) / (LIMITS.marks - 1))]);
    return { rows: sampled, note: `Plot shows ${LIMITS.marks.toLocaleString()} evenly spaced rows of ${rows.length.toLocaleString()}. Underlying data is retained; use SQL aggregation for authoritative trends.` };
  }
  return { rows, note: '' };
}
