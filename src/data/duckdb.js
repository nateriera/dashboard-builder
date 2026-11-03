import { createQueryCoordinator } from "./queryCoordinator.js";
import { LIMITS } from "./limits.js";
import { prepareStatement } from "./sqlStatement.js";
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
import { withDroppedCount } from './dataQuality.js';
import { retainSourceRows } from './rowProvenance.js';
import { substituteParameters } from "./parameters.js";
import { compileTransformChain, validateTransformChain } from './wranglingTransforms.js';
import {
  buildTableStatements,
  materializeRows,
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
    const trimmed = prepareStatement(sql);
    const { conn } = await getDB();
    const result = await conn.query('SELECT * FROM (' + trimmed + ') AS dashboard_result LIMIT ' + (LIMITS.queryRows + 1));
    return materializeRows(result);
  },
  executeDetailed: async sql => {
    const trimmed = prepareStatement(sql);
    const { conn } = await getDB();
    const result = await conn.query('SELECT * FROM (' + trimmed + ') AS dashboard_result LIMIT ' + (LIMITS.queryRows + 1));
    return materializeRows(result);
  }
});
export function ensureTables() { return coordinator.ensure(); }
export function runQuery(sql) { return coordinator.run(sql); }
export function runQueryDetailed(sql) { return coordinator.runDetailed(sql); }

/** Full SQL counts/provenance plus at most five editor sample rows. This
 * shares the serialized execution/revision fence with ordinary SQL queries. */
export async function previewTransformChain(input, parameters = [], { sampleOnly = true, refreshSchema = true } = {}) {
  let chain=validateTransformChain(input,{parameters});
  const source=chain.source.sql?`(${prepareStatement(chain.source.sql)}) AS source_schema`:'"'+chain.source.table.replaceAll('"','""')+'"';
  const schema=await runQueryDetailed(substituteParameters(`SELECT * FROM ${source} LIMIT 0`,parameters));
  const revision=schema.revision;
  if(refreshSchema) chain={...chain,source:{...chain.source,schema:{columns:schema.columns,types:schema.types}}};
  else {
    const category=type=>/^(?:U?Int|Float|Double|Decimal|BigInt)/i.test(type)?'numeric':/Date|Timestamp/i.test(type)?'date':/Utf8|Char|String/i.test(type)?'text':type;
    if(JSON.stringify(chain.source.schema.columns)!==JSON.stringify(schema.columns)||chain.source.schema.columns.some(column=>category(chain.source.schema.types[column])!==category(schema.types[column]))) throw new Error('Transform source schema changed. Open Transform and preview again.');
  }
  const plan=compileTransformChain(chain,{parameters});
  const run=async sql=>{
    const result=await runQueryDetailed(substituteParameters(sql,parameters));
    if(result.revision!==revision||datasetVersion()!==revision) throw new Error('Datasets changed during transform preview. Run again.');
    return result;
  };
  const steps=[];
  let blocked=false;
  for(const step of plan.steps) {
    let reason=step.reason||(blocked?'A preceding step is disabled.':null);
    if(!reason) for(const guard of plan.guards.filter(guard=>guard.stepId===step.id)) {
      const result=await run(guard.sql),value=Object.values(result.rows[0]||{})[0]||0;
      if(guard.max!==undefined?value>guard.max:value>0){reason=guard.reason;break;}
    }
    if(step.disabled||reason){steps.push({...step,disabled:true,reason,rowsIn:null,rowsOut:null,exclusions:{},provenance:[]});blocked=true;continue;}
    const result=await run(step.diagnosticsSql),counts=result.rows[0];
    const provenance=Object.entries(counts).filter(([key])=>key.startsWith('excluded:aggregate:')).map(([key,count])=>({kind:'aggregate',name:key.slice(19),count}));
    if(step.op==='bucket') provenance.push({kind:'invalidDates',count:counts['excluded:invalidDates']});
    const exclusions=Object.fromEntries(provenance.map(item=>[item.kind==='aggregate'?item.name:'invalidDates',item.count]));
    steps.push({...step,rowsIn:counts.rowsIn,rowsOut:counts.rowsOut,exclusions,provenance});
  }
  const errors=[...plan.errors,...steps.filter(step=>step.disabled&&!plan.steps.find(item=>item.id===step.id)?.disabled).map(step=>`${step.id}: ${step.reason}`)];
  if(steps.at(-1)?.rowsOut>LIMITS.queryRows) errors.push(`Transform output exceeds the ${LIMITS.queryRows.toLocaleString()} row query budget.`);
  if(errors.length)return {chain:plan.chain,sql:null,columns:plan.columns,types:plan.types,rows:[],steps,errors,revision};
  const result=await run(sampleOnly?`SELECT * FROM (${plan.sql}) AS transform_preview LIMIT 5`:plan.sql);
  return {...result,chain:plan.chain,sql:plan.sql,steps,errors:[],revision};
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
// qid -> {revision, identity, rows, sourceRows}; fields are part of identity.

const queryCache = new Map();

export function getCachedRows(qid, query, entry, parameters = []) {
  const e = queryCache.get(qid);
  if(query.chain){const plan=compileTransformChain(query.chain,{parameters});if(!plan.sql||plan.sql!==query.sql)return null;}
  const resolvedSql = substituteParameters(query.sql, parameters);
  return e && e.revision === datasetVersion() && e.identity === JSON.stringify([query,entry?.fields,resolvedSql]) ? e.rows : null;
}
export function dropCachedRows(qid) { queryCache.delete(qid); }
export async function runTileQuery(qid, query, entry, parameters = []) {
  if(query.chain){const plan=compileTransformChain(query.chain,{parameters});if(!plan.sql||plan.sql!==query.sql)throw new Error(plan.errors.join(' ')||'Saved SQL does not match its transform chain.');}
  const resolvedSql = substituteParameters(query.sql, parameters);
  const result=query.chain?await previewTransformChain(query.chain,parameters,{sampleOnly:false,refreshSchema:false}):await runQuery(resolvedSql);
  if(result.errors?.length)throw new Error(result.errors.join(' '));
  const { rows, revision } = result;
  const { rows: normalized, dropped } = normalizeRows(entry, rows, query.mapping || {});
  if (revision !== datasetVersion()) throw new Error('Datasets changed. Run again.');
  // Keep the query's original columns alongside normalized chart fields so
  // dashboard filters can match materialized source column names.
  const materialized = retainSourceRows(withDroppedCount(rows.map((row, index) => ({ ...row, ...normalized[index] })), dropped), rows);
  queryCache.set(qid, { revision, identity: JSON.stringify([query,entry.fields,resolvedSql]), rows: materialized, sourceRows: rows });
  return materialized;
}
