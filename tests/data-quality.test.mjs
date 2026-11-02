import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankingNotice, droppedCount, withDroppedCount, materializeExportRows } from '../src/data/dataQuality.js';

test('normalization counts stay associated with their result array without becoming row data', () => {
  const rows = [{value:null}];
  assert.equal(withDroppedCount(rows, 2), rows);
  assert.equal(droppedCount(rows), 2);
  assert.equal(droppedCount([{value:null}]), 0);
  assert.equal(JSON.stringify(rows), '[{"value":null}]');
  assert.equal(blankingNotice(2), '2 non-numeric values blanked');
});

test('export materialization blanks non-finite cells without changing live rows', () => {
  const rows = [{nan:NaN,positive:Infinity,negative:-Infinity,zero:0,text:'Infinity',missing:null}];
  const result = materializeExportRows(rows);
  assert.equal(result.blanked, 3);
  assert.deepEqual(result.rows, [{nan:null,positive:null,negative:null,zero:0,text:'Infinity',missing:null}]);
  assert.equal(result.sourceRows, result.rows);
  assert.equal(Number.isNaN(rows[0].nan), true);
  assert.equal(rows[0].positive, Infinity);
  assert.equal(blankingNotice(result.blanked, 'non-finite'), '3 non-finite values blanked');
});

test('export source and composite copies count each non-finite cell position once', () => {
  const rows = [{label:'Mapped',value:Infinity}];
  const source = [{label:'Original',value:Infinity,other:NaN}];
  const result = materializeExportRows(rows, source);
  assert.equal(result.blanked, 2);
  assert.deepEqual(result.rows, [{label:'Mapped',value:null}]);
  assert.deepEqual(result.sourceRows, [{label:'Original',value:null,other:null}]);
});
