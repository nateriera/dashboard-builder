import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareStatement } from '../src/data/sqlStatement.js';

test('statement preparation strips only code comments and accepts one trailing terminator', () => {
  assert.equal(prepareStatement(' /* leading ; \' " */ SELECT /* middle */ (1) -- tail ;\n; /* end */'), 'SELECT   (1)');
  for (const literal of ["'-- /* ; () */'", '"-- /* ; () */"', '$$-- /* ; () */$$', '$tag$-- /* ; () */$tag$']) {
    assert.equal(prepareStatement(`SELECT ${literal};`), `SELECT ${literal}`);
  }
  assert.equal(prepareStatement("SELECT 'it''s; fine', \"a\"\";b\";"), "SELECT 'it''s; fine', \"a\"\";b\"");
  assert.equal(prepareStatement("SELECT E'it\\'s; (fine)' /* tail */;"), "SELECT E'it\\'s; (fine)'");
});

test('statement preparation rejects internal or repeated code semicolons', () => {
  for (const sql of ['SELECT 1; SELECT 2', 'SELECT 1;;', 'SELECT 1; /* inert */ ;', 'SELECT 1) AS escaped; DROP TABLE upload_sales; SELECT 1 --']) {
    assert.throws(() => prepareStatement(sql), /Queries must be a single statement\./);
  }
});

test('statement preparation enforces code parentheses before wrapping', () => {
  assert.equal(prepareStatement('WITH x AS (SELECT (1)) SELECT * FROM x;'), 'WITH x AS (SELECT (1)) SELECT * FROM x');
  for (const sql of ['SELECT (1', 'SELECT 1)', 'SELECT )(1']) {
    assert.throws(() => prepareStatement(sql), /Unbalanced parentheses in query\./);
  }
});

test('statement preparation fails closed on unterminated lexical constructs', () => {
  for (const sql of ["SELECT 'oops", 'SELECT "oops', 'SELECT $$oops', 'SELECT $tag$oops', 'SELECT 1 /* oops', "SELECT E'escaped\\'"]) {
    assert.throws(() => prepareStatement(sql), /Unterminated/);
  }
  assert.equal(prepareStatement('SELECT 1 -- no newline'), 'SELECT 1');
});

test('statement preparation preserves the SELECT/WITH-only contract', () => {
  for (const sql of ['', '/* empty */', 'DELETE FROM sales', 'SELECTED 1']) {
    assert.throws(() => prepareStatement(sql), /Only SELECT\/WITH queries are supported\./);
  }
  assert.throws(() => prepareStatement(null), /SQL must be text/);
});
