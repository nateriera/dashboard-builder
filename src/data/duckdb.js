// DuckDB-WASM in-browser SQL (phase 2b).
//
// Lazy singleton: the duckdb-wasm ESM bundle and its .wasm binary load only
// when first needed (SQL tab opened, or a query tile rendering), via dynamic
// import() of this module — they never slow the initial page load. Both the
// worker script and the .wasm are bundled by Vite (?url) and served from the
// same static host: zero network calls beyond the host itself, no CDN.
//
// The single-threaded MVP bundle is used deliberately: no COOP/COEP headers
// needed, so it works on any plain static host.
//
// Tables: every sample dataset plus every in-memory uploaded dataset is
// registered as a DuckDB table (CREATE OR REPLACE TABLE + chunked INSERTs,
// built by ./sql.js). Query results flow back through the registry's
// fields/normalize machinery, exactly like uploads.

import duckdbWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import * as duckdb from "@duckdb/duckdb-wasm";

import { DATASETS, DATASET_LABELS } from "../tiles/registry.js";
import { listDatasets, datasetVersion } from "./store.js";
import { normalizeRows } from "../tiles/normalize.js";
import {
  buildTableStatements,
  materializeResult,
  rowColumns,
  sampleTableName,
  uploadTableName
} from "./sql.js";

// ── Lazy singleton ────────────────────────────────────────────────────────
let dbPromise = null;

async function initDB() {
  const worker = new Worker(duckdbWorkerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(duckdbWasmUrl);
  const conn = await db.connect();
  return { db, conn };
}

async function getDB() {
  if (!dbPromise) {
    dbPromise = initDB().catch((err) => {
      dbPromise = null; // let a later attempt retry
      throw err;
    });
  }
  return dbPromise;
}

// ── Table registration ────────────────────────────────────────────────────
// tableEpoch bumps on every completed sync; cached query results are only
// valid for the epoch they ran under, so uploads/imports automatically
// invalidate them (see "Query lifecycle" in the README).

let tableEpoch = 0;
let syncedVersion = -1;
let syncPromise = null;

function collectDatasetTables() {
  const out = [];
  for (const [key, rows] of Object.entries(DATASETS)) {
    out.push({ table: sampleTableName(key), columns: rowColumns(rows), rows });
  }
  for (const ds of listDatasets()) {
    out.push({ table: uploadTableName(ds.id), columns: rowColumns(ds.rows), rows: ds.rows });
  }
  return out;
}

async function syncTables(datasets) {
  const { conn } = await getDB();
  for (const { table, columns, rows } of datasets) {
    for (const stmt of buildTableStatements(table, columns, rows)) {
      await conn.query(stmt);
    }
  }
  tableEpoch++;
}

/** Make sure the registered tables match the current in-memory datasets.
 *  Concurrent calls coalesce; a newer dataset version always triggers a
 *  fresh sync after any in-flight one settles. */
export async function ensureTables() {
  await getDB();
  const v = datasetVersion();
  if (v === syncedVersion) return;
  if (!syncPromise || syncPromise.version !== v) {
    const p = (async () => {
      await syncTables(collectDatasetTables());
      syncedVersion = v;
    })();
    syncPromise = Object.assign(p, { version: v });
    const clear = () => {
      if (syncPromise === p) syncPromise = null;
    };
    p.then(clear, clear);
  }
  await syncPromise;
}

// ── Queries ───────────────────────────────────────────────────────────────

export async function runQuery(sql) {
  const { conn } = await getDB();
  const result = await conn.query(sql);
  return materializeResult(result);
}

/** Tables shown in the SQL tab: exact names, so queries need no guessing. */
export function listTables() {
  const tables = Object.keys(DATASETS).map((key) => ({
    name: sampleTableName(key),
    label: DATASET_LABELS[key] || key,
    kind: "sample"
  }));
  for (const ds of listDatasets()) {
    tables.push({ name: uploadTableName(ds.id), label: `${ds.name} (upload)`, kind: "upload" });
  }
  return tables;
}

// ── Result cache ──────────────────────────────────────────────────────────
// qid -> {epoch, rows}. A tile re-renders from cache when the epoch matches;
// anything that re-registers tables (upload, import) bumps the epoch and the
// next render re-runs the query.

const queryCache = new Map();

export function getCachedRows(qid) {
  const e = queryCache.get(qid);
  return e && e.epoch === tableEpoch ? e.rows : null;
}

function setCachedRows(qid, rows) {
  queryCache.set(qid, { epoch: tableEpoch, rows });
}

export function dropCachedRows(qid) {
  queryCache.delete(qid);
}

/** Run a saved query for a tile: ensure tables, execute, normalize through
 *  the tile's field declarations (same as uploads), cache the result. */
export async function runTileQuery(qid, query, entry) {
  await ensureTables();
  const { rows } = await runQuery(query.sql);
  const { rows: normalized } = normalizeRows(entry, rows, query.mapping || {});
  setCachedRows(qid, normalized);
  return normalized;
}
