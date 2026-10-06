import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPivotSql } from '../src/data/wrangling.js';

test('pivot refuses SUM and AVG for known non-numeric source columns', () => {
  assert.throws(() => buildPivotSql({ table: 't', groups: [], types: { label: 'Utf8' }, aggregations: [{ column: 'label', operation: 'SUM' }] }), /numeric column/i);
});
