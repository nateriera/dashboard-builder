import test from 'node:test';
import assert from 'node:assert/strict';
import { wranglingConfigToken } from '../src/data/wrangling.js';

const pivotConfig = () => ({
  table: 'upload_sales',
  sourceSql: 'SELECT * FROM upload_sales WHERE region = {{region}}',
  groups: [{ column: 'region', bin: null }, { column: 'order_date', bin: 'month' }],
  aggregations: [
    { column: 'revenue', operation: 'SUM', name: 'Total revenue' },
    { column: 'units', operation: 'AVG', name: 'Average units' }
  ],
  parameters: [{ name: 'region', type: 'text', value: 'West' }]
});

const formulaConfig = () => ({
  table: 'upload_sales',
  sourceSql: 'SELECT * FROM upload_sales WHERE region = {{region}}',
  formula: 'revenue * {{factor}}',
  name: 'Adjusted revenue',
  parameters: [
    { name: 'region', type: 'text', value: 'West' },
    { name: 'factor', type: 'number', value: 1.5 }
  ]
});

test('wrangling configuration tokens are deterministic for identical pivot snapshots and do not mutate them', () => {
  const config = pivotConfig();
  const before = structuredClone(config);
  const token = wranglingConfigToken('pivot', config);
  assert.equal(typeof token, 'string');
  assert.equal(token, wranglingConfigToken('pivot', config));
  assert.equal(token, wranglingConfigToken('pivot', structuredClone(config)));
  assert.deepEqual(config, before);
});

test('wrangling configuration tokens are deterministic for identical formula snapshots', () => {
  const config = formulaConfig();
  assert.equal(wranglingConfigToken('formula', config), wranglingConfigToken('formula', structuredClone(config)));
});

test('pivot tokens change for every grouping and aggregation SQL input', () => {
  const changes = [
    ['group column', config => { config.groups[0].column = 'country'; }],
    ['group date bin', config => { config.groups[1].bin = 'quarter'; }],
    ['aggregation column', config => { config.aggregations[0].column = 'net_revenue'; }],
    ['aggregation operation', config => { config.aggregations[0].operation = 'AVG'; }],
    ['aggregation output name', config => { config.aggregations[0].name = 'Revenue total'; }]
  ];
  const original = pivotConfig();
  for (const [field, change] of changes) {
    const changed = structuredClone(original);
    change(changed);
    assert.notEqual(wranglingConfigToken('pivot', changed), wranglingConfigToken('pivot', original), field);
  }
});

test('formula tokens change when either the expression or output name changes', () => {
  const original = formulaConfig();
  for (const [field, value] of [['formula', 'revenue * {{factor}} + 1'], ['name', 'Adjusted total']]) {
    const changed = { ...original, [field]: value };
    assert.notEqual(wranglingConfigToken('formula', changed), wranglingConfigToken('formula', original), field);
  }
});

test('both token kinds include the source table and raw source SQL', () => {
  for (const [kind, original] of [['pivot', pivotConfig()], ['formula', formulaConfig()]]) {
    for (const [field, value] of [['table', 'upload_other'], ['sourceSql', 'SELECT * FROM upload_sales WHERE region = {{other}}']]) {
      const changed = { ...original, [field]: value };
      assert.notEqual(wranglingConfigToken(kind, changed), wranglingConfigToken(kind, original), `${kind} ${field}`);
    }
  }
  const config = { ...pivotConfig(), ...formulaConfig() };
  assert.notEqual(wranglingConfigToken('pivot', config), wranglingConfigToken('formula', config));
});

test('both token kinds capture parameter values rather than a live parameter reference', () => {
  for (const [kind, config] of [['pivot', pivotConfig()], ['formula', formulaConfig()]]) {
    const previewToken = wranglingConfigToken(kind, config);
    config.parameters[0].value = 'East';
    assert.notEqual(wranglingConfigToken(kind, config), previewToken, `${kind} text parameter`);
  }
  const config = formulaConfig();
  const previewToken = wranglingConfigToken('formula', config);
  config.parameters[1].value = 2;
  assert.notEqual(wranglingConfigToken('formula', config), previewToken, 'numeric parameter');
});

test('pivot token preserves grouping order', () => {
  const config = pivotConfig();
  const reordered = structuredClone(config);
  reordered.groups.reverse();
  assert.notEqual(wranglingConfigToken('pivot', config), wranglingConfigToken('pivot', reordered));
});

test('pivot token preserves aggregation order', () => {
  const config = pivotConfig();
  const reordered = structuredClone(config);
  reordered.aggregations.reverse();
  assert.notEqual(wranglingConfigToken('pivot', config), wranglingConfigToken('pivot', reordered));
});
