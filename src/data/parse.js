import { LIMITS, assertRows } from "./limits.js";
// File parsing for tile data uploads: CSV (via d3-dsv) and JSON.
//
// parseFile(name, text) -> { columns: string[], rows: object[] }
// Throws an Error with a user-friendly message when the file can't be used.

import { csvParseRows } from "d3-dsv";

// Keep uploads sane for an in-browser, localStorage-backed store.
export const MAX_ROWS = 250000;

const WRAPPER_KEYS = ["data", "rows", "results", "items"];

export function parseFile(name, text) {
  if (new TextEncoder().encode(text).length > LIMITS.fileBytes) throw new Error("File limit is 16 MiB. Split or aggregate the file.");
  const result = /\.json$/i.test(name) ? parseJson(text) : parseCsv(text);
  assertRows(result.rows);
  if (result.columns.length > LIMITS.columns) throw new Error(`Column limit is ${LIMITS.columns}.`);
  return result;
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  // Unwrap one obvious level: {data:[...]}, {rows:[...]}, etc.
  if (!Array.isArray(data) && data && typeof data === "object") {
    for (const k of WRAPPER_KEYS) {
      if (Array.isArray(data[k])) {
        data = data[k];
        break;
      }
    }
  }
  if (!Array.isArray(data)) {
    throw new Error(
      "JSON needs to be an array of objects (or an object wrapping one under data/rows/results/items)."
    );
  }
  if (!data.length) throw new Error("The JSON array is empty.");
  if (data.length > MAX_ROWS) {
    throw new Error(`Too many rows (${data.length.toLocaleString()}); the limit is ${MAX_ROWS.toLocaleString()}.`);
  }
  if (data.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
    throw new Error("Every item in the JSON array must be an object.");
  }
  // Column order: first-appearance across rows.
  const columns = [];
  const seen = new Set();
  for (const r of data) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  return { columns, rows: data };
}

// Duplicate header names would collapse into one object key and silently
// overwrite an earlier column's values, so later occurrences are renamed
// (<name>_2, <name>_3, ...) to the first suffix that collides with no
// original header and no already-assigned name — preserving every column.
function dedupeColumns(rawColumns) {
  const original = new Set(rawColumns);
  const used = new Set();
  return rawColumns.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let suffix = 2;
    let candidate = `${name}_${suffix}`;
    while (used.has(candidate) || original.has(candidate)) {
      suffix += 1;
      candidate = `${name}_${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}

function parseCsv(text) {
  let parsed;
  try {
    parsed = csvParseRows(text);
  } catch {
    throw new Error("That file couldn't be parsed as CSV.");
  }
  const rawColumns = parsed[0] || [];
  if (!rawColumns.length) throw new Error("No columns found — is this a valid CSV file?");
  if (parsed.length < 2) throw new Error("The CSV has headers but no data rows.");
  if (parsed.length - 1 > MAX_ROWS) {
    throw new Error(`Too many rows (${(parsed.length - 1).toLocaleString()}); the limit is ${MAX_ROWS.toLocaleString()}.`);
  }
  const columns = dedupeColumns(rawColumns);
  // Build rows as own properties (Object.fromEntries), so a reserved name
  // such as __proto__ becomes a real key that assertRows can reject instead
  // of silently vanishing into the prototype. Ragged rows keep the previous
  // object-parse semantics: missing cells are "", extra cells are dropped.
  const rows = parsed.slice(1).map((values) =>
    Object.fromEntries(columns.map((column, i) => [column, values[i] ?? ""]))
  );
  return { columns, rows };
}
