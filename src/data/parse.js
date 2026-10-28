import { LIMITS, assertRows } from "./limits.js";
// File parsing for tile data uploads: CSV (via d3-dsv) and JSON.
//
// parseFile(name, text) -> { columns: string[], rows: object[] }
// Throws an Error with a user-friendly message when the file can't be used.

import { csvParse } from "d3-dsv";

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

function parseCsv(text) {
  let rows;
  try {
    rows = csvParse(text);
  } catch {
    throw new Error("That file couldn't be parsed as CSV.");
  }
  const columns = rows.columns || [];
  if (!columns.length) throw new Error("No columns found — is this a valid CSV file?");
  // Header names key every row object, so a duplicate name silently
  // overwrites the earlier column's values, an empty name keys data
  // under "", and "__proto__" never becomes an own key — its column
  // silently vanishes (and slips past the reserved-name check in
  // assertRows, which only sees own keys). The paste parser
  // (importSource.js) already rejects all three; match it here.
  const seenColumns = new Set();
  for (const column of columns) {
    if (!column || ["__proto__", "constructor", "prototype"].includes(column)) throw new Error("Header names must be non-empty and cannot be reserved words.");
    if (seenColumns.has(column)) throw new Error(`Duplicate column name: ${column}.`);
    seenColumns.add(column);
  }
  if (!rows.length) throw new Error("The CSV has headers but no data rows.");
  if (rows.length > MAX_ROWS) {
    throw new Error(`Too many rows (${rows.length.toLocaleString()}); the limit is ${MAX_ROWS.toLocaleString()}.`);
  }
  return { columns, rows };
}
