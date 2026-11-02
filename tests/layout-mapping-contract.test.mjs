import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
const { TILE_TYPES } = await import('../src/tiles/registry.js');
const { validateLayout, assertNoCollisions } = await import('../src/data/layout.js');

const sourceRecord = () => ({name:'Sales',columns:['label'],rows:[{label:'Original'}],fieldKeys:[],mapping:{}});

test('layout validation rejects dataset IDs differing only by case and names both without changing input', () => {
  const candidate = {app:'dashboard-builder',version:1,tiles:[],datasets:{Sales:sourceRecord(),sales:sourceRecord()}};
  const before = structuredClone(candidate);
  assert.throws(()=>validateLayout(candidate), error=>error.message.includes('Sales') && error.message.includes('sales'));
  assert.deepEqual(candidate,before);
});

test('import collision validation rejects case-distinct incoming and resident dataset IDs', () => {
  const candidate = validateLayout({app:'dashboard-builder',version:1,tiles:[],datasets:{sales:sourceRecord()}});
  const old = {...candidate.datasets.sales,id:'Sales'};
  assert.throws(()=>assertNoCollisions(candidate,id=>id==='Sales'?old:null,()=>null,['Sales']), error=>error.message.includes('Sales') && error.message.includes('sales'));
  assert.equal(old.id,'Sales');
});

test('same-case identical dataset imports remain valid and query IDs use a separate non-table namespace', () => {
  const candidate = validateLayout({app:'dashboard-builder',version:1,tiles:[],datasets:{Sales:sourceRecord()},queries:{sales:{sql:'SELECT 1',columns:[],fieldKeys:[],mapping:{}}}});
  assert.doesNotThrow(()=>assertNoCollisions(candidate,id=>candidate.datasets[id],()=>null,['Sales']));
});

test('layout validation accepts every registry field key in a mapped tile query', () => {
  for (const [type, entry] of Object.entries(TILE_TYPES)) {
    if (!entry.fields.length) continue;
    const mapping = Object.fromEntries(entry.fields.map(field => [field.key, `column_${field.key}`]));
    const candidate = {
      app: 'dashboard-builder', version: 1,
      tiles: [{ id: 'contract', type, dataset: 'query:contract', x: 0, y: 0, w: 6, h: 5 }],
      queries: { contract: { sql: 'SELECT 1', columns: Object.values(mapping), fieldKeys: entry.fields.map(field => field.key), mapping } }
    };
    let validated;
    assert.doesNotThrow(() => { validated = validateLayout(candidate); }, `${type}: ${Object.keys(mapping).join(', ')}`);
    assert.deepEqual(validated.queries.contract.mapping, mapping);
  }
});

test('treemap parent dataset mappings survive layout serialization and validation', () => {
  const mapping = { label: 'label', value: 'value', parent: 'parent' };
  const candidate = {
    app: 'dashboard-builder', version: 1,
    tiles: [{ id: 'tree', type: 'treemap', dataset: 'upload:tree', x: 0, y: 0, w: 8, h: 7 }],
    datasets: { tree: { name: 'Hierarchy', columns: ['label', 'value', 'parent'], fieldKeys: ['label', 'value', 'parent'], mapping, rows: [{ label: 'A', value: 12, parent: 'Programs' }] } }
  };
  const roundTrip = validateLayout(JSON.parse(JSON.stringify(validateLayout(candidate))));
  assert.deepEqual(roundTrip.datasets.tree.mapping, mapping);
});
