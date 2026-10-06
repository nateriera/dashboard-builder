import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregationOptions, buildCalculatedFieldApplySql, buildCalculatedFieldSql, buildPivotSql, dateBinExpression, quoteIdentifier } from '../src/data/wrangling.js';

const table = 'upload_sales';

test('pivot SQL preserves grouping and aggregation order and quotes identifiers', () => {
  assert.equal(buildPivotSql({
    table,
    groups: [{ column: 'region', bin: null }, { column: 'Order date', bin: 'quarter' }],
    aggregations: [
      { column: 'gross"sales', operation: 'SUM', name: 'Gross' },
      { column: 'units', operation: 'AVG', name: 'Average units' }
    ]
  }), 'SELECT "region" AS "region", (strftime(date_trunc(\'quarter\', TRY_CAST("Order date" AS TIMESTAMP)), \'%Y\') || \'-Q\' || CAST(quarter(TRY_CAST("Order date" AS TIMESTAMP)) AS VARCHAR)) AS "Order date (quarter)", SUM("gross""sales") AS "Gross", AVG("units") AS "Average units" FROM "upload_sales" GROUP BY "region", (strftime(date_trunc(\'quarter\', TRY_CAST("Order date" AS TIMESTAMP)), \'%Y\') || \'-Q\' || CAST(quarter(TRY_CAST("Order date" AS TIMESTAMP)) AS VARCHAR))');
});

test('pivot SQL rejects missing groups, aggregations and unsupported operations', () => {
  assert.throws(() => buildPivotSql({ table, groups: [], aggregations: [] }), /grouping or aggregation/i);
  assert.throws(() => buildPivotSql({ table, groups: [], aggregations: [{ column: 'units', operation: 'SUM; DROP TABLE x' }] }), /unsupported aggregation/i);
});

test('date bin expressions provide sortable month, quarter and year labels', () => {
  assert.match(dateBinExpression('Order date', 'month'), /%Y-%m/);
  assert.match(dateBinExpression('Order date', 'quarter'), /-Q/);
  assert.match(dateBinExpression('Order date', 'year'), /%Y/);
  assert.throws(() => dateBinExpression('Order date', 'week'), /month, quarter, or year/i);
});

test('aggregation options follow the selected DuckDB column type', () => {
  assert.deepEqual(aggregationOptions('DOUBLE'), ['COUNT', 'COUNT DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']);
  assert.deepEqual(aggregationOptions('VARCHAR'), ['COUNT', 'COUNT DISTINCT', 'MIN', 'MAX']);
  assert.deepEqual(aggregationOptions('BOOLEAN'), ['COUNT', 'COUNT DISTINCT', 'MIN', 'MAX']);
});

test('calculated field SQL quotes the source and validates the output name', () => {
  assert.equal(buildCalculatedFieldSql({ table, formula: 'price * quantity', name: 'Total' }), 'SELECT *, (price * quantity) AS "Total" FROM "upload_sales" LIMIT 5');
  assert.throws(() => buildCalculatedFieldSql({ table, formula: '', name: 'Total' }), /formula/i);
  assert.throws(() => buildCalculatedFieldSql({ table, formula: 'price', name: 'region' , columns: ['region'] }), /already exists/i);
});

test('identifier quoting doubles embedded quotes', () => {
  assert.equal(quoteIdentifier('a"b'), '"a""b"');
});
