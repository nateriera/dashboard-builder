// Saved-SQL-query store (phase 2b): in-memory Map backed by localStorage.
//
// Tiles reference queries as "query:<id>" (mirroring "upload:<id>"). Each
// Apply in the SQL tab saves a NEW immutable query entry; queries no tile
// references are pruned so the store can't grow without bound. Queries are
// small text, so all of them persist — no size budget like the dataset store.

import { isQueryRef, queryId } from "./sql.js";

export { isQueryRef, queryId };

const LS_KEY = "dashbuilder.queries.v1";
const LEGACY_LS_KEY = "klaroDash.queries.v1"; // pre-theme era; read once, then dropped

const memory = new Map(); // id -> {id, name, sql, columns, fieldKeys, mapping}
let seq = 0;

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return { next: 1, items: {} };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return { next: 1, items: {} };
    return { next: typeof obj.next === "number" ? obj.next : 1, items: obj.items || {} };
  } catch {
    return { next: 1, items: {} };
  }
}

function writeAll(next) {
  const items = {};
  for (const [id, q] of memory) {
    items[id] = { name: q.name, sql: q.sql, columns: q.columns, fieldKeys: q.fieldKeys, mapping: q.mapping, dependencies: q.dependencies ?? null };
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ next, items }));
    localStorage.removeItem(LEGACY_LS_KEY);
    return true;
  } catch {
    // Callers can distinguish a durable save from a session-only query.
    return false;
  }
}

/** Save a query validated by Run. Returns {id, name}. */
export function saveQuery({ name, sql, columns, fieldKeys, mapping, dependencies = null }) {
  const id = `q${Date.now().toString(36)}${seq++}`;
  const entry = {
    id,
    dependencies,
    name: null, // filled below
    sql,
    columns: columns || [],
    fieldKeys: fieldKeys || [],
    mapping: mapping || {}
  };
  let persisted = false;
  if (name) {
    entry.name = name;
    memory.set(id, entry);
    persisted = writeAll(readAll().next);
  } else {
    const all = readAll();
    entry.name = `Query ${all.next}`;
    memory.set(id, entry);
    persisted = writeAll(all.next + 1);
  }
  return { id, name: entry.name, persisted };
}

export function getQuery(id) {
  return memory.get(id) || null;
}

export function hasQuery(id) {
  return memory.has(id);
}

/** Drop every query no referenced dataset id needs. `refs` are tile dataset
 *  strings ("query:<id>", "upload:<id>", sample keys). */
export function pruneQueries(refs) {
  const wanted = new Set();
  for (const ref of refs) {
    if (isQueryRef(ref)) wanted.add(queryId(ref));
  }
  let dropped = 0;
  for (const id of [...memory.keys()]) {
    if (!wanted.has(id)) {
      memory.delete(id);
      dropped++;
    }
  }
  if (dropped) writeAll(readAll().next);
  return dropped;
}

/** Populate memory from localStorage on startup. Returns the count loaded. */
export function loadPersistedQueries() {
  const all = readAll();
  let loaded = 0;
  for (const [id, e] of Object.entries(all.items)) {
    if (!e || typeof e.sql !== "string") continue;
    memory.set(id, {
      id,
      name: e.name || id,
      sql: e.sql,
      dependencies: e.dependencies ?? null,
      columns: Array.isArray(e.columns) ? e.columns : [],
      fieldKeys: Array.isArray(e.fieldKeys) ? e.fieldKeys : [],
      mapping: e.mapping && typeof e.mapping === "object" ? e.mapping : {}
    });
    loaded++;
  }
  return loaded;
}

/** Inline every referenced query into an exported layout (always small). */
export function inlineQueries(refs) {
  const inlined = {};
  for (const ref of refs) {
    if (!isQueryRef(ref)) continue;
    const q = memory.get(queryId(ref));
    if (!q) continue;
    inlined[q.id] = { name: q.name, sql: q.sql, columns: q.columns, fieldKeys: q.fieldKeys, mapping: q.mapping, dependencies: q.dependencies ?? null };
  }
  return inlined;
}

/** Restore queries inlined in an imported layout file. Returns count added. */
export function querySnapshot() { return structuredClone([...memory]); }
export function rollbackQueries(snapshot) {
  memory.clear(); for (const [id,q] of snapshot) memory.set(id,q);
}
export function restoreQueries(obj) {
  if (!obj) return 0;
  const pending = Object.entries(obj).filter(([id]) => !memory.has(id));
  for (const [id,e] of pending) memory.set(id,{ ...e,id });
  // The import coordinator commits localStorage together with the layout.
  return pending.length;
}
export function serializeQueries() {
  return JSON.stringify({ next: readAll().next, items: Object.fromEntries(memory) });
}
