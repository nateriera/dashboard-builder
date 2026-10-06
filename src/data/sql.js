import { LIMITS } from "./limits.js";
// Pure SQL helpers for the DuckDB-WASM layer (phase 2b). No DOM, no wasm,
// no kit imports — directly unit-testable in node.
//
// Table registration strategy: every sample dataset and every in-memory
// uploaded dataset becomes a DuckDB table via explicit CREATE TABLE +
// chunked INSERT statements (no Arrow round-trip, no file staging):
//   numbers -> DOUBLE, Dates -> TIMESTAMP, booleans -> BOOLEAN, else VARCHAR.
// Uploads are capped at 20,000 rows by phase 2a; INSERTs are chunked at 500
// rows per statement to keep individual statements small.

// ── Naming ────────────────────────────────────────────────────────────────
// Sample datasets use their registry key verbatim ("categorical",
// "timeseries", ...). Uploads use "upload_<store id>". Both are shown exactly
// in the SQL tab's table list, so queries are writable without guessing.

export function sampleTableName(key) {
  return key;
}

export function uploadTableName(id) {
  return `upload_${id}`;
}

// ── Query refs ────────────────────────────────────────────────────────────
// Tiles reference saved queries as "query:<id>", mirroring "upload:<id>".

export function isQueryRef(ref) {
  return typeof ref === "string" && ref.startsWith("query:");
}

export function queryId(ref) {
  return ref.slice("query:".length);
}

// ── DDL / DML generation ──────────────────────────────────────────────────

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

// Scan a column's values and pick a DuckDB type. Mixed or unknown -> VARCHAR.
function columnType(rows, col) {
  let seen = null;
  for (const r of rows) {
    const v = r[col];
    if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) continue;
    if (v instanceof Date && Number.isNaN(v.getTime())) continue;
    const t = v instanceof Date ? "timestamp" : typeof v === "number" ? "double" : typeof v === "boolean" ? "boolean" : "varchar";
    if (seen == null) seen = t;
    else if (seen !== t) return "varchar";
  }
  return seen || "varchar";
}

const TYPE_SQL = { double: "DOUBLE", timestamp: "TIMESTAMP", boolean: "BOOLEAN", varchar: "VARCHAR" };

const pad2 = (n) => String(n).padStart(2, "0");

// Local-time "YYYY-MM-DD HH:MM:SS" (DuckDB TIMESTAMP literal). Local, not UTC:
// promoteDate() parses "YYYY-MM" as local midnight, so formatting back in
// local time round-trips without day-boundary shifts.
export function formatTimestamp(d) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,"0")}`
  );
}

function formatValue(v, type) {
  if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) return "NULL";
  switch (type) {
    case "double": {
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : "NULL";
    }
    case "boolean":
      return v ? "TRUE" : "FALSE";
    case "timestamp": {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return "NULL";
      return `'${formatTimestamp(d)}'`;
    }
    default:
      return `'${String(v).replace(/'/g, "''")}'`;
  }
}

export const INSERT_CHUNK_ROWS = 500;

/** Build [CREATE OR REPLACE TABLE, INSERT..., INSERT...] for one dataset. */
export function buildTableStatements(table, columns, rows) {
  const types = columns.map((c) => columnType(rows, c));
  const defs = columns.map((c, i) => `${ident(c)} ${TYPE_SQL[types[i]]}`).join(", ");
  const stmts = [`CREATE OR REPLACE TABLE ${ident(table)} (${defs});`];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const vals = rows
      .slice(i, i + INSERT_CHUNK_ROWS)
      .map((r) => `(${columns.map((c, ci) => formatValue(r[c], types[ci])).join(", ")})`)
      .join(", ");
    stmts.push(`INSERT INTO ${ident(table)} VALUES ${vals};`);
  }
  return stmts;
}

/** Union of row keys in first-appearance order (works for samples and for
 *  uploads, whose rows are keyed by field keys after 2a normalization). */
export function rowColumns(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

// ── Result materialization ────────────────────────────────────────────────
// Arrow values need a little help becoming plain JSON-ish rows:
//   - BigInt -> safe Number or exact decimal string
//   - Date instances -> ISO strings ("YYYY-MM-DD", or with time when nonzero)
//   - Arrow epoch-millis Timestamp values -> UTC ISO, refusing finer precision
// Everything else passes through untouched.

export function isoLocal(d) {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return date;
  return `${date}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${d.getMilliseconds() ? "." + String(d.getMilliseconds()).padStart(3,"0") : ""}`;
}

export function sanitizeValue(v, typeName) {
  if (v == null) return null;
  if (/^timestampnanosecond/i.test(typeName || '')) throw new Error('Nanosecond timestamps must be CAST AS VARCHAR to retain exact text.');
  if (/^decimal/i.test(typeName || '')) throw new Error('Exact SQL decimals must be CAST AS VARCHAR for KPI/text display, or explicitly CAST AS DOUBLE for approximate plotting.');
  if (typeof v === "bigint") return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v instanceof Date) return isoLocal(v);
  if (
    typeof v === "number" &&
    Number.isFinite(v) &&
    typeof typeName === "string" &&
    /^timestamp/i.test(typeName)
  ) {
    if (!Number.isInteger(v)) throw new Error("Sub-millisecond timestamps are unsupported. CAST the timestamp AS VARCHAR to retain exact text.");
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error("Timestamp is outside the supported Date range.");
    return d.toISOString();
  }
  return v;
}

/** Materialize one duckdb-wasm result into {columns, rows} of plain objects. */
export function materializeResult(result) {
  const { columns, rows } = materializeRows(result);
  return { columns, rows };
}

/** Materialize a result while retaining DuckDB type metadata for visual controls. */
export function materializeRows(result) {
  if (result.numRows > LIMITS.queryRows) throw new Error(`Query result limit is ${LIMITS.queryRows.toLocaleString()} rows. Add LIMIT or aggregate in SQL.`);
  const fields = result.schema.fields.map((f) => ({
    name: f.name,
    typeName: f.type?.constructor?.name || ""
  }));
  const columns = fields.map((f) => f.name);
  if (fields.length > LIMITS.columns) throw new Error(`Query column limit is ${LIMITS.columns}.`);
  const rows = result.toArray().map((r) => {
    const obj = r.toJSON();
    const out = {};
    for (let i = 0; i < fields.length; i++) {
      out[fields[i].name] = sanitizeValue(obj[fields[i].name], fields[i].typeName);
    }
    return out;
  });
  const types = Object.fromEntries(fields.map(field => [field.name, field.typeName]));
  return { columns, rows, types };
}

// ── Errors ────────────────────────────────────────────────────────────────

/** True when the failure is "that table isn't registered" (as opposed to a
 *  genuine SQL syntax/semantic error, which should surface in the tile). */
export function isMissingTableError(err) {
  return /does not exist|no such table|catalog error/i.test(err?.message || "");
}

// ── SQL tab starter ───────────────────────────────────────────────────────

export function starterQuery(table) {
  return `SELECT *\nFROM ${table}\nLIMIT 10;`;
}
