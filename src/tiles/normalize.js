// Pure data-normalization helpers for tile uploads (no DOM, no kit imports,
// so this module is directly unit-testable in node).
//
// Uploaded files are reshaped into rows keyed by the tile entry's field
// `key`s, so tile render() functions work identically for sample and
// uploaded data.

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
        } else {
          const n = Number(v);
          if (!Number.isFinite(n)) {
            out[f.key] = null;
            dropped++;
          } else {
            out[f.key] = n;
          }
        }
      } else {
        out[f.key] = v == null ? "" : String(v);
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
  return { rows, dropped };
}

/** Promote "YYYY-MM" / "YYYY-MM-DD" (and ISO datetimes "YYYY-MM-DDTHH:MM:SS",
 *  as produced by DuckDB TIMESTAMP results) strings to Date so Plot uses a
 *  time axis; anything else passes through untouched. */
export function promoteDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?(T\d{2}:\d{2}(:\d{2})?)?$/.test(v.trim())) {
    const t = v.trim();
    const d = new Date(t + (t.includes("T") ? "" : "T00:00:00"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return v;
}
