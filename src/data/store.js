import { migrateLegacy } from "./migrate.js";
// Uploaded-dataset store: in-memory Map (sync reads) backed by IndexedDB
// (async persistence via the `idb` wrapper, ISC).
//
// Layouts reference uploaded datasets by id ("upload:<id>"); the layout JSON
// itself stays lean. Datasets live in their own IndexedDB object store so the
// autosaved layout never balloons, and small ones are inlined on Export so an
// exported file is self-contained. Pre-theme-era storage ("klaroDash.*"
// localStorage keys, "klaro-dashboard" IndexedDB) is migrated once on
// startup and then left alone.

import { openDB } from "idb";

const LS_KEY = "dashbuilder.datasets.v1"; // legacy localStorage; migrated to IndexedDB once
const LEGACY_LS_KEY = "klaroDash.datasets.v1"; // older still; read as a fallback
const DB_NAME = "dashbuilder";
const LEGACY_DB_NAME = "klaro-dashboard"; // pre-theme era; copied over once, then left alone
const DB_STORE = "datasets";

// Per-dataset threshold for inlining into an exported layout file.
export const EXPORT_INLINE_BYTES = 500 * 1024;

let seq = 0;
const memory = new Map(); // id -> {id, name, columns, rows, fieldKeys, mapping, raw, bytes, persisted}
// `raw` is the pre-normalization {columns, rows} when the caller provides it.
// Per-tile uploads normalize rows to that tile type's field keys at Apply
// time; keeping the raw parse too lets the dashboard-wide default (and the
// SQL tables) work from the file's original columns for any tile type.

// ── IndexedDB persistence ────────────────────────────────────────────────
// Memory is the source of truth; IndexedDB is the durable backup. Reads stay
// synchronous (memory); writes go through persistDataset().

const dbPromise =
  typeof indexedDB === "undefined"
    ? Promise.reject(new Error("IndexedDB unavailable"))
    : openDB(DB_NAME, 1, {
        upgrade(db) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      });
// Defensive: every real use awaits dbPromise inside try/catch, but mark it
// handled so non-browser environments never see an unhandled rejection.
dbPromise.catch(() => {});

function storable(entry) {
  const { persisted, ...rest } = entry;
  return rest;
}

/** Durably store one in-memory dataset. Resolves true on success. */
export async function persistDataset(id) {
  const entry = memory.get(id);
  if (!entry) return false;
  try {
    const db = await dbPromise;
    const record = storable(entry);
    await db.put(DB_STORE, record);
    if (JSON.stringify(await db.get(DB_STORE,id)) !== JSON.stringify(record)) throw new Error("Dataset verification failed");
    entry.persisted = true;
    return true;
  } catch {
    entry.persisted = false;
    return false;
  }
}

// Bumped whenever the in-memory dataset set changes (upload saved, import
// restored). The DuckDB layer (phase 2b) uses it to know when its registered
// tables are stale.
let version = 0;
const revisionListeners = new Set();
export function subscribeDatasetChanges(listener) { revisionListeners.add(listener); return () => revisionListeners.delete(listener); }
function bumpVersion() { version++; for (const listener of revisionListeners) listener(version); }
export function datasetVersion() {
  return version;
}

export function isUploadRef(ref) {
  return typeof ref === "string" && ref.startsWith("upload:");
}

export function uploadId(ref) {
  return ref.slice("upload:".length);
}

/** All in-memory datasets (for DuckDB table registration, phase 2b).
 *  Prefers the raw pre-normalization rows when present, so SQL sees the
 *  file's original columns rather than one tile type's field keys. */
export function listDatasets() {
  return [...memory.values()].map(({ id, name, rows, raw }) => ({
    id,
    name,
    rows: raw ? raw.rows : rows
  }));
}

/** Populate memory from IndexedDB on startup. One-time migrates the legacy
 *  localStorage key ("klaroDash.datasets.v1") and removes it. Resolves the
 *  count loaded. */
let migrationFailures = [];
export function storageIssues() { return [...migrationFailures]; }
export async function loadPersistedDatasets() {
  let db = null;
  try { db = await dbPromise; } catch { /* preserve legacy sources */ }
  const ingest = (id,e,persisted) => {
    if (!e || !Array.isArray(e.rows)) return;
    const prior = memory.get(id);
    if (prior) { if (persisted && JSON.stringify(prior.rows) === JSON.stringify(e.rows)) prior.persisted = true; return; }
    memory.set(id,{ ...e, id, name: e.name || id, columns: e.columns || [], fieldKeys: e.fieldKeys || [], mapping: e.mapping || {}, raw: e.raw || null, bytes: e.bytes || new TextEncoder().encode(JSON.stringify(e)).length, persisted });
  };
  if (db) {
    try { for (const e of await db.getAll(DB_STORE)) ingest(e.id,e,true); } catch { /* migration still keeps sources */ }
  }
  migrationFailures = await migrateLegacy({ storage: globalThis.localStorage, keys: [LS_KEY,LEGACY_LS_KEY], db, ingest });
  // The old IndexedDB database remains a recovery source even after copying.
  try {
    const databases = await globalThis.indexedDB?.databases?.();
    if (databases?.some(d => d.name === LEGACY_DB_NAME)) {
      const oldDb = await openDB(LEGACY_DB_NAME,1);
      for (const e of await oldDb.getAll(DB_STORE)) {
        ingest(e.id,e,false);
        if (!(await persistDataset(e.id))) migrationFailures.push(e.id + ': legacy database retained; session-only data');
      }
      oldDb.close();
    }
  } catch { migrationFailures.push('Legacy database could not be read; retained for retry.'); }
  if (memory.size) bumpVersion();
  return memory.size;
}

/** Store an uploaded dataset in memory. Normalization (if any) is the caller's
 *  job — pass `raw: {columns, rows}` to also keep the pre-normalization
 *  parse. Returns {id, bytes}. Follow with `await persistDataset(id)`. */
export function saveDataset({ name, columns, rows, fieldKeys, mapping, raw = null }) {
  const id = `u${Date.now().toString(36)}${seq++}`;
  const bytes = JSON.stringify(rows).length + (raw ? JSON.stringify(raw.rows).length : 0);
  memory.set(id, {
    id,
    name,
    columns,
    rows,
    fieldKeys,
    mapping,
    raw,
    bytes,
    persisted: false
  });
  bumpVersion();
  return { id, bytes };
}

export function getDataset(id) {
  return memory.get(id) || null;
}

export function hasDataset(id) {
  return memory.has(id);
}

/** Split referenced upload datasets into inlinable vs. too-large-for-export. */
export function inlineDatasets(refs) {
  const inlined = {};
  const skipped = [];
  for (const ref of refs) {
    if (!isUploadRef(ref)) continue;
    const ds = memory.get(uploadId(ref));
    if (!ds) { skipped.push(`${ref} (missing)`); continue; }
    if (ds.bytes <= EXPORT_INLINE_BYTES) {
      inlined[ds.id] = {
        name: ds.name,
        columns: ds.columns,
        rows: ds.rows,
        fieldKeys: ds.fieldKeys,
        mapping: ds.mapping,
        raw: ds.raw || null
      };
    } else {
      skipped.push(`${ds.name} (${ds.id}: ${ds.bytes.toLocaleString()} bytes exceeds ${EXPORT_INLINE_BYTES.toLocaleString()} byte inline limit)`);
    }
  }
  return { inlined, skipped };
}

/** Restore datasets inlined in an imported layout file. Persists them to
 *  IndexedDB as well. Resolves the count added. */
export async function restoreDatasets(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const pending = Object.entries(obj).filter(([id]) => !memory.has(id));
  if (!pending.length) return 0;
  const db = await dbPromise;
  const tx = db.transaction(DB_STORE,'readwrite');
  try {
    for (const [id,e] of pending) {
      const record = { ...e,id,bytes: new TextEncoder().encode(JSON.stringify(e)).length };
      await tx.store.add(record);
      const verified = await tx.store.get(id);
      if (JSON.stringify(record) !== JSON.stringify(verified)) throw new Error('Dataset verification failed');
    }
    await tx.done;
  } catch (err) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw err; }
  for (const [id,e] of pending) memory.set(id,{ ...e,id,bytes: new TextEncoder().encode(JSON.stringify(e)).length,persisted: true });
  bumpVersion();
  return pending.length;
}
// Only rolls back newly introduced import ids; never replaces existing records.
export async function rollbackDatasets(ids) {
  if (!ids.length) return;
  const db = await dbPromise;
  const tx = db.transaction(DB_STORE,'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
  for (const id of ids) memory.delete(id);
  bumpVersion();
}
