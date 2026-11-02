import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglingSourceSql } from '../src/data/wrangling.js';

test('wrangling source SQL removes at most one trailing semicolon', () => {
  assert.equal(wranglingSourceSql({ sql: 'SELECT 1;' }), 'SELECT 1');
  assert.equal(wranglingSourceSql({ sql: 'SELECT 1;;' }), 'SELECT 1;');
});

test('wrangling source SQL removes a trailing semicolon and its following whitespace', () => {
  assert.equal(wranglingSourceSql({ sql: 'SELECT 1; \r\n\t' }), 'SELECT 1');
});

test('wrangling source SQL without a terminator stays unchanged, including placeholders', () => {
  const query = { sql: ' SELECT {{region}}, {{factor}} \n' };
  assert.equal(wranglingSourceSql(query), query.sql);
  assert.deepEqual(query, { sql: ' SELECT {{region}}, {{factor}} \n' });
});

test('wrangling source SQL preserves internal semicolons for the execution boundary to reject', () => {
  assert.equal(wranglingSourceSql({ sql: 'SELECT 1; SELECT 2;' }), 'SELECT 1; SELECT 2');
  assert.equal(wranglingSourceSql({ sql: "SELECT ';' AS label;" }), "SELECT ';' AS label");
});

test('wrangling source SQL keeps absent and empty saved-query sources null', () => {
  for (const query of [null, undefined, {}, { sql: '' }]) assert.equal(wranglingSourceSql(query), null);
});
