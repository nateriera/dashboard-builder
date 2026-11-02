import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableStatements } from '../src/data/sql.js';

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
