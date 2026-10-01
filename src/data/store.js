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
    await db.put(DB_STORE, storable(entry));
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
export async function loadPersistedDatasets() {
  let loaded = 0;
  // Legacy migration (2a era): move localStorage entries into IndexedDB once.
  let legacy = null;
  try {
    const rawLS = localStorage.getItem(LS_KEY) || localStorage.getItem(LEGACY_LS_KEY);
    if (rawLS) {
      const obj = JSON.parse(rawLS);
      if (obj && typeof obj === "object") legacy = obj;
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LEGACY_LS_KEY);
    }
  } catch {
    // Corrupt legacy data: drop it rather than fail startup.
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LEGACY_LS_KEY);
    } catch {
      /* ignore */
    }
  }
  let db = null;
  try {
    db = await dbPromise;
  } catch {
    db = null; // IndexedDB unavailable: memory-only this session
  }
  const ingest = (id, e) => {
    if (!e || !Array.isArray(e.rows) || memory.has(id)) return false;
    memory.set(id, {
      id,
      name: e.name || id,
      columns: e.columns || [],
      rows: e.rows,
      fieldKeys: e.fieldKeys || [],
      mapping: e.mapping || {},
      raw: e.raw && Array.isArray(e.raw.rows) ? e.raw : null,
      bytes: typeof e.bytes === "number" ? e.bytes : JSON.stringify(e.rows).length,
      persisted: true
    });
    return true;
  };
  if (legacy) {
    for (const [id, e] of Object.entries(legacy)) {
      if (!ingest(id, e)) continue;
      loaded++;
      if (db) {
        try {
          await db.put(DB_STORE, storable(memory.get(id)));
        } catch {
          /* best effort */
        }
      }
    }
    version++;
  }
  if (db) {
    try {
      for (const e of await db.getAll(DB_STORE)) {
        if (ingest(e.id, e)) loaded++;
      }
      if (loaded) version++;
    } catch {
      // Unreadable store: memory-only this session.
    }
    // Pre-theme-era database rename: if the new database came up empty,
    // copy any datasets from the old one exactly once.
    if (loaded === 0) {
      try {
        const oldDb = await openDB(LEGACY_DB_NAME, 1);
        const oldEntries = await oldDb.getAll(DB_STORE).catch(() => []);
        for (const e of oldEntries) {
          if (ingest(e.id, e)) {
            loaded++;
            try {
              await db.put(DB_STORE, storable(memory.get(e.id)));
            } catch {
              /* best effort */
            }
          }
        }
        if (loaded) version++;
        oldDb.close();
      } catch {
        // No old database (or unreadable): nothing to migrate.
      }
    }
  }
  return loaded;
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
  version++;
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
    if (!ds) continue;
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
      skipped.push(ds.name);
    }
  }
  return { inlined, skipped };
}

/** Restore datasets inlined in an imported layout file. Persists them to
 *  IndexedDB as well. Resolves the count added. */
export async function restoreDatasets(obj) {
  if (!obj || typeof obj !== "object") return 0;
  let added = 0;
  for (const [id, e] of Object.entries(obj)) {
    if (!e || !Array.isArray(e.rows) || memory.has(id)) continue;
    memory.set(id, {
      id,
      name: e.name || id,
      columns: e.columns || [],
      rows: e.rows,
      fieldKeys: e.fieldKeys || [],
      mapping: e.mapping || {},
      raw: e.raw && Array.isArray(e.raw.rows) ? e.raw : null,
      bytes: JSON.stringify(e.rows).length,
      persisted: false
    });
    added++;
  }
  if (!added) return 0;
  version++; // tables changed: DuckDB registrations (phase 2b) go stale
  for (const id of Object.keys(obj)) {
    if (memory.has(id)) await persistDataset(id);
  }
  return added;
}
