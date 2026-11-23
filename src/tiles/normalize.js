// Pure data-normalization helpers for tile uploads (no DOM, no kit imports,
// so this module is directly unit-testable in node).
//
// Uploaded files are reshaped into rows keyed by the tile entry's field
// `key`s, so tile render() functions work identically for sample and
// uploaded data.

import { withDroppedCount } from '../data/dataQuality.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Common header synonyms so the auto-guess works on real-world files
// ("Category" -> label, "Amount" -> value, "Month" -> date, ...).
const SYNONYMS = {
  label: ["name", "category", "title", "segment"],
  value: ["amount", "count", "total", "sum"],
  date: ["day", "month", "year", "time", "period"],
  group: ["segment", "cohort", "category"],
  delta: ["change", "diff", "variance"],
  deltaDir: ["direction"]
};

/** Suggest a column mapping: case-insensitive match on field key, known
 *  synonyms, and label words — then substring fallback. */
export function guessMapping(entry, columns) {
  if (entry.dynamicFields) return {};
  const cols = columns.map((c) => ({ orig: c, n: norm(c) }));
  const mapping = {};
  for (const f of entry.fields) {
    const candidates = new Set([
      norm(f.key),
      ...((SYNONYMS[f.key.toLowerCase()] || []).map(norm)),
      ...f.label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(norm)
    ]);
    const hit =
      cols.find((c) => candidates.has(c.n)) ||
      cols.find((c) => [...candidates].some((k) => k.length > 2 && c.n.includes(k)));
    if (hit) mapping[f.key] = hit.orig;
  }
  return mapping;
}

/** Rename mapped columns to field keys; coerce numeric fields (non-numeric
 *  values become null and are counted). Returns {rows, dropped}. */
export function normalizeRows(entry, rawRows, mapping) {
  // Table tiles deliberately retain every source column and its original
  // scalar type; IDs and exact decimal strings must not be coerced.
  if (entry.dynamicFields) return { rows: withDroppedCount(rawRows.map(row => ({ ...row })), 0), dropped: 0 };
  let dropped = 0;
  const rows = rawRows.map((raw) => {
    const out = {};
    for (const f of entry.fields) {
      const col = mapping[f.key];
      if (col == null) continue; // optional field left unmapped
      const v = raw[col];
      if (f.numeric) {
        if (v == null || v === "") {
          out[f.key] = null;
        } else if (typeof v === 'string' && v.trim() === '') {
          out[f.key] = null;
          dropped++;
        } else {
          const n = Number(v);
          if ((typeof v === "string" && /^[+-]?\d+$/.test(v.trim()) && (BigInt(v.trim()) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(v.trim()) < BigInt(Number.MIN_SAFE_INTEGER))) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
            throw new Error(`Precision error in ${col}: ${v}. Keep exact values in a KPI/text field or explicitly round in SQL before plotting.`);
          }
          if (!Number.isFinite(n)) {
            out[f.key] = null;
            dropped++;
          } else {
            out[f.key] = n;
          }
        }
      } else {
        out[f.key] = v == null ? null : String(v);
      }
    }
    return out;
  });
  // KPI nicety: derive the delta direction from the change text's sign when
  // the user mapped a delta but no explicit direction column.
  if (
    entry.fields.some((f) => f.key === "delta") &&
    mapping.delta != null &&
    mapping.deltaDir == null
  ) {
    for (const r of rows) {
      if (r.delta && !r.deltaDir) {
        const n = Number(String(r.delta).replace(/[^0-9.\-+]/g, ""));
        if (!Number.isNaN(n) && n !== 0) r.deltaDir = n > 0 ? "up" : "down";
      }
    }
  }
  return { rows: withDroppedCount(rows, dropped), dropped };
}

/** Promote "YYYY-MM" / "YYYY-MM-DD" (and ISO datetimes "YYYY-MM-DDTHH:MM:SS",
 *  as produced by DuckDB TIMESTAMP results) strings to Date so Plot uses a
 *  time axis; anything else passes through untouched. */
export function promoteDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v.trim())) {
    const t = v.trim();
    const d = new Date(t + (t.includes("T") ? "" : "T00:00:00"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return v;
}

// ── Protected HTML export (§5) ────────────────────────────────────────────
// Column minimization for exported files. Projection is column-only and
// happens at export time, on copies — the composer's stored, cached and
// sample data are never mutated, and no row is ever dropped by count.

/** Extra row keys a tile type's render consumes beyond its declared fields.
 *  Histogram reads `value ?? y ?? x` on plain rows and `start, end, value,
 *  key` on pre-binned rows (src/charts/charts.js); KPI cards read `invert`
 *  (src/charts/charts.js, kpiRow). Every other type needs only its fields. */
export const EXPORT_ROW_EXTRAS = {
  histogram: ['x', 'y', 'start', 'end', 'key'],
  kpi: ['invert']
};

/** The row keys an exported tile keeps: its declared field keys plus
 *  extras. Returns null for dynamic-field (table) tiles: every column is
 *  the data, so there is nothing to project. */
export function exportRowKeys(entry, extraKeys = []) {
  if (entry.dynamicFields) return null;
  if (entry.noData) return [];
  return [...new Set([...entry.fields.map((f) => f.key), ...extraKeys])];
}

/** Project rows onto the export allowlist (§5.1): field keys + extras
 *  (type extras and filter-target fields, supplied by the caller).
 *  Table tiles are exempt and returned copied whole; text tiles have no
 *  rows. A key absent from a row is simply absent from the projected row —
 *  no nulls are inserted. Never mutates its input. */
export function projectExportRows(entry, rows, extraKeys = []) {
  if (entry.dynamicFields) return rows.map((row) => ({ ...row }));
  if (entry.noData) return [];
  const keep = new Set(exportRowKeys(entry, extraKeys));
  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) if (keep.has(key)) out[key] = row[key];
    return out;
  });
}

/** Project one inlined backup dataset for the HTML export (§5.5).
 *  `dataset` is an inlined record {name, columns, rows, fieldKeys, mapping,
 *  raw} as built by inlineDatasets. `referencingTiles` are the layout tiles
 *  that use this dataset — directly, via a saved query's dependencies, or
 *  by following the dashboard default. `fieldsForType` maps a tile type to
 *  its registry entry; `filterFieldsForTile(tileId, pageId)` returns the
 *  filter-target fields for one tile.
 *  `minimize: false` returns the dataset unchanged (the JSON export path,
 *  §5.6). A dataset any table tile uses is exempt and returned unchanged:
 *  its columns are the data. If no referencing tile contributes a key, the
 *  dataset is returned unchanged rather than emptied (fail safe).
 *  Returns a new record; never mutates the input. */
export function projectBackupDataset(dataset, referencingTiles, fieldsForType, filterFieldsForTile, minimize = true) {
  if (!minimize) return dataset;
  const rowKeys = new Set();
  const rawKeys = new Set();
  for (const tile of referencingTiles) {
    const entry = fieldsForType(tile.type);
    if (!entry) continue;
    if (entry.dynamicFields) return dataset; // table tile: exempt
    if (entry.noData) continue;
    const extras = EXPORT_ROW_EXTRAS[tile.type] || [];
    const filterFields = filterFieldsForTile ? filterFieldsForTile(tile.id, tile.pageId) : [];
    const keys = [...new Set([...entry.fields.map((f) => f.key), ...extras, ...filterFields])];
    for (const key of keys) rowKeys.add(key);
    // Raw columns: the dataset's stored mapping first, guessed mapping as
    // fallback (dashboard-default uploads store an empty mapping).
    const mapping = dataset.mapping || {};
    const guessed = guessMapping(entry, dataset.columns || []);
    for (const key of keys) {
      if (!entry.fields.some((f) => f.key === key)) continue;
      const col = mapping[key] || guessed[key];
      if (col != null) rawKeys.add(col);
    }
    for (const field of filterFields) rawKeys.add(field);
  }
  if (rowKeys.size === 0 && rawKeys.size === 0) return dataset;
  const project = (rows, keys) => rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) if (keys.has(key)) out[key] = row[key];
    return out;
  });
  // dataset.rows are normalized (field keys) when fieldKeys is non-empty;
  // dashboard-default uploads store the raw parse as rows instead (see
  // src/main.js: the dashboard upload saves fieldKeys: [] with raw rows).
  const rowsAreRaw = !dataset.fieldKeys || dataset.fieldKeys.length === 0;
  const rows = project(dataset.rows || [], rowsAreRaw ? rawKeys : rowKeys);
  const raw = dataset.raw
    ? { columns: dataset.raw.columns.filter((c) => rawKeys.has(c)), rows: project(dataset.raw.rows, rawKeys) }
    : null;
  const columns = raw
    ? dataset.columns.filter((c) => rawKeys.has(c))
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    ...dataset,
    columns,
    rows,
    fieldKeys: (dataset.fieldKeys || []).filter((k) => rowKeys.has(k)),
    mapping: Object.fromEntries(
      Object.entries(dataset.mapping || {}).filter(([k, v]) => rowKeys.has(k) && rawKeys.has(v))
    ),
    raw
  };
}
