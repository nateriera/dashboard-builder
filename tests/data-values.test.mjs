import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableStatements } from '../src/data/sql.js';
import { normalizeRows } from '../src/tiles/normalize.js';
import { distinctValues } from '../src/data/filters.js';

test('VARCHAR registration preserves empty strings separately from null and NaN', () => {
  const statements = buildTableStatements('text_values', ['text'], [{text:''},{text:null},{text:NaN},{text:'Present'}]);
  assert.equal(statements[0], 'CREATE OR REPLACE TABLE "text_values" ("text" VARCHAR);');
  assert.equal(statements[1], 'INSERT INTO "text_values" VALUES (\'\'), (NULL), (NULL), (\'Present\');');
});

test('non-text registration continues to insert empty strings as NULL', () => {
  assert.equal(buildTableStatements('numbers', ['value'], [{value:2},{value:''},{value:null}])[1], 'INSERT INTO "numbers" VALUES (2), (NULL), (NULL);');
  assert.equal(buildTableStatements('flags', ['value'], [{value:true},{value:''},{value:false}])[1], 'INSERT INTO "flags" VALUES (TRUE), (NULL), (FALSE);');
});

test('registration keeps whitespace strings verbatim and infers VARCHAR as before', () => {
  const statements = buildTableStatements('mixed', ['value'], [{value:1},{value:' '}]);
  assert.equal(statements[0], 'CREATE OR REPLACE TABLE "mixed" ("value" VARCHAR);');
  assert.equal(statements[1], 'INSERT INTO "mixed" VALUES (\'1\'), (\' \');');
});

const numericEntry = { fields:[{key:'label'},{key:'value',numeric:true}] };
const identityMapping = {label:'label',value:'value'};

test('numeric normalization blanks and counts whitespace while retaining explicit-empty semantics', () => {
  const input = [' ', '\t\n', '\u00a0', '', null, 0, '0', ' 2 '].map((value,index) => ({label:`Row ${index}`,value}));
  const before = structuredClone(input);
  const result = normalizeRows(numericEntry, input, identityMapping);
  assert.deepEqual(result.rows.map(row => row.value), [null,null,null,null,null,0,0,2]);
  assert.equal(result.dropped, 3);
  assert.deepEqual(input, before);
});

test('category normalization retains null separately from empty text through filter value discovery', () => {
  const result = normalizeRows(numericEntry, [{label:null,value:1},{value:2},{label:'',value:3}], identityMapping);
  assert.deepEqual(result.rows.map(row => row.label), [null,null,'']);
  assert.deepEqual(distinctValues(result.rows, 'label').values, [null,'']);
});
