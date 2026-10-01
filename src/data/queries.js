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
    items[id] = { name: q.name, sql: q.sql, columns: q.columns, fieldKeys: q.fieldKeys, mapping: q.mapping };
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ next, items }));
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    // Quota or unavailable storage: memory-only for this session.
  }
}

/** Save a query validated by Run. Returns {id, name}. */
export function saveQuery({ name, sql, columns, fieldKeys, mapping }) {
  const id = `q${Date.now().toString(36)}${seq++}`;
  const entry = {
    id,
    name: null, // filled below
    sql,
    columns: columns || [],
    fieldKeys: fieldKeys || [],
    mapping: mapping || {}
  };
  if (name) {
    entry.name = name;
    memory.set(id, entry);
    writeAll(readAll().next);
  } else {
    const all = readAll();
    entry.name = `Query ${all.next}`;
    memory.set(id, entry);
    writeAll(all.next + 1);
  }
  return { id, name: entry.name };
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
    inlined[q.id] = { name: q.name, sql: q.sql, columns: q.columns, fieldKeys: q.fieldKeys, mapping: q.mapping };
  }
  return inlined;
}

/** Restore queries inlined in an imported layout file. Returns count added. */
export function restoreQueries(obj) {
  if (!obj || typeof obj !== "object") return 0;
  let added = 0;
  for (const [id, e] of Object.entries(obj)) {
    if (!e || typeof e.sql !== "string" || memory.has(id)) continue;
    memory.set(id, {
      id,
      name: e.name || id,
      sql: e.sql,
      columns: Array.isArray(e.columns) ? e.columns : [],
      fieldKeys: Array.isArray(e.fieldKeys) ? e.fieldKeys : [],
      mapping: e.mapping && typeof e.mapping === "object" ? e.mapping : {}
    });
    added++;
  }
  if (added) writeAll();
  return added;
}
