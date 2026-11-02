import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregationOptions, buildCalculatedFieldApplySql, buildCalculatedFieldSql, buildPivotSql, dateBinExpression, quoteIdentifier } from '../src/data/wrangling.js';
import { mapWranglingRecipeColumns, parsePortableWranglingRecipes, serializePortableWranglingRecipes } from '../src/data/wranglingRecipes.js';

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

test('portable pivot recipes round-trip and map saved columns to a different schema', () => {
  const recipe={id:'recipe-pivot',name:'Regional totals',kind:'pivot',groups:[{column:'Area',bin:null}],aggregations:[{column:'Amount',operation:'SUM',name:'Total'}]};
  const encoded=serializePortableWranglingRecipes([recipe]);
  const [imported]=parsePortableWranglingRecipes(encoded);
  const mapped=mapWranglingRecipeColumns(imported,{Area:'Region',Amount:'Revenue'},['Region','Revenue']);
  assert.deepEqual(mapped.groups,[{column:'Region',bin:null}]);
  assert.deepEqual(mapped.aggregations,[{column:'Revenue',operation:'SUM',name:'Total'}]);
});

test('portable calculated-field recipes remap quoted identifiers without changing literals', () => {
  const recipe={id:'recipe-formula',name:'Extended price',kind:'formula',formula:'"Unit price" * "Units" + 1',outputName:'Extended',columns:['Unit price','Units']};
  const [imported]=parsePortableWranglingRecipes(serializePortableWranglingRecipes([recipe]));
  const mapped=mapWranglingRecipeColumns(imported,{'Unit price':'Price','Units':'Quantity'},['Price','Quantity']);
  assert.equal(mapped.formula,'"Price" * "Quantity" + 1');
});

test('portable calculated-field recipes remap bare simple identifiers too', () => {
  const recipe={id:'recipe-formula',name:'Extended price',kind:'formula',formula:'price * quantity + 1',outputName:'Extended',columns:['price','quantity']};
  const mapped=mapWranglingRecipeColumns(recipe,{price:'cost',quantity:'units'},['cost','units']);
  assert.equal(mapped.formula,'"cost" * "units" + 1');
});

test('portable wrangling recipes reject malformed envelopes and incomplete mappings', () => {
  assert.throws(()=>parsePortableWranglingRecipes('{"version":9}'),/format|version/i);
  const recipe={id:'recipe-pivot',name:'Regional totals',kind:'pivot',groups:[{column:'Area',bin:null}],aggregations:[]};
  assert.throws(()=>mapWranglingRecipeColumns(recipe,{Area:'Missing'},['Region']),/available columns/i);
});

test('formula recipe remapping resolves overlapping targets simultaneously and leaves input intact', () => {
  const recipe = { id:'overlap',name:'Difference',kind:'formula',formula:'"A" - "B"',outputName:'Difference',columns:['A','B'] };
  const before = structuredClone(recipe);
  for (const mapping of [{ A:'B',B:'C' }, { B:'C',A:'B' }]) {
    const mapped = mapWranglingRecipeColumns(recipe, mapping, ['B','C']);
    assert.equal(mapped.formula, '"B" - "C"');
    assert.deepEqual(mapped.columns, ['B','C']);
  }
  assert.deepEqual(recipe, before);
});

test('formula recipe remapping swaps identifiers without rescanning replacements', () => {
  const recipe = { id:'swap',name:'Swap',kind:'formula',formula:'"A" - "B"',outputName:'Difference',columns:['A','B'] };
  const mapped = mapWranglingRecipeColumns(recipe, { A:'B',B:'A' }, ['A','B']);
  assert.equal(mapped.formula, '"B" - "A"');
  assert.deepEqual(mapped.columns, ['B','A']);
});

test('formula recipe remapping preserves escaped quotes, string literals, and unmapped identifiers', () => {
  const recipe = { id:'quoted',name:'Quoted',kind:'formula',formula:'"A""B" + \'A"B\' + "unmapped"',outputName:'Quoted result',columns:['A"B'] };
  const mapped = mapWranglingRecipeColumns(recipe, { 'A"B':'B"C' }, ['B"C']);
  assert.equal(mapped.formula, '"B""C" + \'A"B\' + "unmapped"');
  assert.deepEqual(mapped.columns, ['B"C']);
});

test('formula recipe remapping preserves bare function names even when a column has the same name', () => {
  const recipe = { id:'functions',name:'Functions',kind:'formula',formula:"ABS (A) + ABS + untouched + 'A B' + B",outputName:'Result',columns:['A','B','ABS'] };
  const mapped = mapWranglingRecipeColumns(recipe, { A:'B',B:'C',ABS:'Magnitude' }, ['B','C','Magnitude']);
  assert.equal(mapped.formula, 'ABS ("B") + "Magnitude" + untouched + \'A B\' + "C"');
});

test('formula recipe remapping without stored columns uses original identifier tokens once', () => {
  const recipe = { id:'discovery',name:'Discovery',kind:'formula',formula:'A - B',outputName:'Difference' };
  const mapped = mapWranglingRecipeColumns(recipe, { A:'B',B:'C' }, ['B','C']);
  assert.equal(mapped.formula, '"B" - "C"');
  assert.deepEqual(mapped.columns, ['B','C']);
});
