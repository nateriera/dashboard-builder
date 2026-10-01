import { createQueryCoordinator } from "./queryCoordinator.js";
import { LIMITS } from "./limits.js";
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
// All synchronization and execution is serialized. Cache eligibility compares
// the store revision immediately, before the next synchronization begins.

let registered = new Set();
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
  await conn.query('BEGIN TRANSACTION');
  try {
    const wanted = new Set(datasets.map(d => d.table));
    for (const table of registered) if (!wanted.has(table)) await conn.query('DROP TABLE IF EXISTS "' + table.replaceAll('"','""') + '"');
    for (const { table, columns, rows } of datasets) {
      if (!columns.length) continue;
      for (const stmt of buildTableStatements(table, columns, rows)) await conn.query(stmt);
    }
    await conn.query('COMMIT'); registered = wanted;
  } catch (err) { await conn.query('ROLLBACK'); throw err; }
}
const coordinator = createQueryCoordinator({
  revision: datasetVersion, collect: collectDatasetTables, sync: syncTables,
  execute: async sql => {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!/^(SELECT|WITH)\b/i.test(trimmed)) throw new Error('Only SELECT/WITH queries are supported.');
    const { conn } = await getDB();
    const result = await conn.query('SELECT * FROM (' + trimmed + ') AS dashboard_result LIMIT ' + (LIMITS.queryRows + 1));
    return materializeResult(result);
  }
});
export function ensureTables() { return coordinator.ensure(); }
export function runQuery(sql) { return coordinator.run(sql); }

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
// qid -> {revision, identity, rows}; field contracts are part of identity.

const queryCache = new Map();

export function getCachedRows(qid, query, entry) {
  const e = queryCache.get(qid);
  return e && e.revision === datasetVersion() && e.identity === JSON.stringify([query,entry?.fields]) ? e.rows : null;
}
export function dropCachedRows(qid) { queryCache.delete(qid); }
export async function runTileQuery(qid, query, entry) {
  const { rows, revision } = await runQuery(query.sql);
  const { rows: normalized } = normalizeRows(entry, rows, query.mapping || {});
  if (revision !== datasetVersion()) throw new Error('Datasets changed. Run again.');
  queryCache.set(qid, { revision, identity: JSON.stringify([query,entry.fields]), rows: normalized });
  return normalized;
}
