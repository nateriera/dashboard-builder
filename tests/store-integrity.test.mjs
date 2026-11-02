import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fake from 'fake-indexeddb';
import { openDB } from 'idb';

for (const key of ['IDBDatabase','IDBRequest','IDBTransaction','IDBObjectStore','IDBIndex','IDBCursor','IDBKeyRange']) globalThis[key] = fake[key];
let scenario = 0;
async function freshStore(t) {
  globalThis.indexedDB = new fake.IDBFactory();
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const store = await import(`../src/data/store.js?integrity=${scenario++}`);
  const db = await openDB('dashbuilder', 1);
  t.after(() => db.close());
  return { store, db, storage };
}

const dataset = (rows = [{ label:'東京🙂' }], raw = null) => ({ name:'Unicode',columns:['label'],rows,fieldKeys:[],mapping:{},raw });
const bytes = entry => new TextEncoder().encode(JSON.stringify(entry.rows)).length + (entry.raw ? new TextEncoder().encode(JSON.stringify(entry.raw.rows)).length : 0);

test('dataset saves measure normalized and raw row payloads in UTF-8 bytes', async t => {
  const { store } = await freshStore(t);
  const entry = dataset([{ label:'東京🙂' }], { columns:['City'],rows:[{ City:'naïve 東京🙂' }] });
  const saved = store.saveDataset(entry);
  assert.equal(saved.bytes, bytes(entry));
  assert.equal(store.getDataset(saved.id).bytes, bytes(entry));
});

test('dataset bytes and inline eligibility survive an actual inline export/import round trip', async t => {
  const { store } = await freshStore(t);
  const entry = dataset([{ label:'界'.repeat(1000) }], { columns:['City'],rows:[{ City:'東京🙂'.repeat(500) }] });
  const saved = store.saveDataset(entry);
  assert.equal(await store.persistDataset(saved.id), true);
  const exported = store.inlineDatasets([`upload:${saved.id}`]);
  assert.deepEqual(exported.skipped, []);
  const portable = JSON.parse(JSON.stringify(exported.inlined));
  await store.rollbackDatasets([saved.id]);
  assert.equal(await store.restoreDatasets(portable), 1);
  assert.equal(store.getDataset(saved.id).bytes, saved.bytes);
  assert.equal(store.getDataset(saved.id).bytes, bytes(entry));
  assert.deepEqual(store.inlineDatasets([`upload:${saved.id}`]).skipped, []);
});

test('multi-byte payloads over the 500 KiB UTF-8 budget are excluded on fresh save', async t => {
  const { store } = await freshStore(t);
  const entry = dataset([{ label:'界'.repeat(180000) }]);
  const saved = store.saveDataset(entry);
  assert.ok(saved.bytes > store.EXPORT_INLINE_BYTES);
  const exported = store.inlineDatasets([`upload:${saved.id}`]);
  assert.deepEqual(exported.inlined, {});
  assert.match(exported.skipped[0], /Unicode.*exceeds/);
});

test('current-database loads recompute stale saved byte counts using the canonical payload measure', async t => {
  const { store, db } = await freshStore(t);
  const entry = dataset([{ label:'東京🙂' }], { columns:['City'],rows:[{ City:'東京🙂' }] });
  await db.put('datasets', { ...entry,id:'stale',bytes:1 });
  await store.loadPersistedDatasets();
  assert.equal(store.getDataset('stale').bytes, bytes(entry));
  assert.equal(store.getDataset('stale').persisted, true);
});

test('dataset restoration excludes id and stale byte metadata from its byte measure', async t => {
  const { store, db } = await freshStore(t);
  const entry = dataset();
  await store.restoreDatasets({ imported:{ ...entry,id:'untrusted-metadata',bytes:999 } });
  assert.equal(store.getDataset('imported').bytes, bytes(entry));
  assert.equal((await db.get('datasets','imported')).bytes, bytes(entry));
});

test('a current-database getAll failure is reported and a successful retry clears it', async t => {
  const { store } = await freshStore(t);
  const getAll = fake.IDBObjectStore.prototype.getAll;
  fake.IDBObjectStore.prototype.getAll = function (...args) {
    if (this.transaction.db.name === 'dashbuilder' && this.name === 'datasets') throw new Error('Injected current read failure');
    return getAll.apply(this, args);
  };
  try {
    await store.loadPersistedDatasets();
    assert.ok(store.storageIssues().some(issue => /current.*database.*read/i.test(issue)));
  } finally { fake.IDBObjectStore.prototype.getAll = getAll; }
  await store.loadPersistedDatasets();
  assert.deepEqual(store.storageIssues(), []);
});

test('a conflicting legacy localStorage record is named while prior rows and original source stay intact', async t => {
  const { store, storage } = await freshStore(t);
  const prior = dataset([{ label:'Current rows' }]);
  await store.restoreDatasets({ shared:prior });
  const raw = JSON.stringify({ shared:dataset([{ label:'Legacy rows' }]) });
  storage.set('klaroDash.datasets.v1', raw);
  await store.loadPersistedDatasets();
  assert.deepEqual(store.getDataset('shared').rows, prior.rows);
  assert.equal(storage.get('klaroDash.datasets.v1'), raw);
  assert.ok(store.storageIssues().some(issue => issue.includes('shared') && /collision/i.test(issue)));
});

test('a conflicting legacy IndexedDB record is named and retained without replacing current rows', async t => {
  const { store, db } = await freshStore(t);
  const prior = dataset([{ label:'Current rows' }]);
  const legacy = dataset([{ label:'Legacy rows' }]);
  await store.restoreDatasets({ shared:prior });
  const oldDb = await openDB('klaro-dashboard', 1, { upgrade(database) { database.createObjectStore('datasets', { keyPath:'id' }); } });
  t.after(() => oldDb.close());
  await oldDb.put('datasets', { ...legacy,id:'shared' });
  await store.loadPersistedDatasets();
  assert.deepEqual(store.getDataset('shared').rows, prior.rows);
  assert.deepEqual((await db.get('datasets','shared')).rows, prior.rows);
  assert.deepEqual((await oldDb.get('datasets','shared')).rows, legacy.rows);
  assert.ok(store.storageIssues().some(issue => issue.includes('shared') && /collision/i.test(issue)));
});
