import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
const { TILE_TYPES } = await import('../src/tiles/registry.js');
const { validateLayout } = await import('../src/data/layout.js');

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
