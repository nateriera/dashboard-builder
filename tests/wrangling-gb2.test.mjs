import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePivotTransformStep, compileTransformChain, transformParameterDependencies } from '../src/data/wranglingTransforms.js';

const schema={columns:['sequence','day','region','category','units','visits','signups'],types:{sequence:'Int32',day:'Utf8',region:'Utf8',category:'Utf8',units:'Double',visits:'Double',signups:'Double'}};
const makeChain=(steps,sourceSchema=schema)=>({version:1,source:{table:'orders',dependencies:[],schema:sourceSchema,order:{kind:'sourceOrdinal'}},steps,outputMapping:{}});
const pivot=(params={})=>({id:'pivot-1',op:'pivot',params:{rowFields:['region'],columnField:'category',measureField:'units',aggregate:'SUM',...params}});

test('GB-2 Pivot has distinct row, column, and measure roles and a separately named compiler',()=>{
  const chain=makeChain([pivot()]);
  const plan=compileTransformChain(chain);
  assert.match(plan.sql,/PIVOT/i);
  assert.equal(plan.steps[0].op,'pivot');
  assert.equal(plan.steps[0].outputMetadata.categories,null);
  assert.deepEqual(chain.steps[0].params.rowFields,['region']);
  assert.throws(()=>compileTransformChain(makeChain([pivot({rowFields:['category']})])),/roles must use distinct fields/);
  assert.equal(typeof compilePivotTransformStep,'function');
});

test('GB-2 Pivot enumerates current categories in first-seen order and disambiguates colliding labels with recoverable metadata',()=>{
  const categories=[{value:'North / West',label:'North / West',firstSeen:2},{value:'North - West',label:'North - West',firstSeen:9}];
  const plan=compileTransformChain(makeChain([pivot()]),{pivotCategories:{'pivot-1':categories}});
  assert.deepEqual(plan.columns,['region','pivot_north_west','pivot_north_west__2']);
  assert.deepEqual(plan.steps[0].outputMetadata.categories.map(item=>[item.value,item.column]),[['North / West','pivot_north_west'],['North - West','pivot_north_west__2']]);
  assert.match(plan.steps[0].sql,/COALESCE\(SUM\(/);
  assert.match(plan.steps[0].sql,/IS NOT DISTINCT FROM/);
  assert.equal(JSON.stringify(plan.chain.steps[0].params).includes('North / West'),false,'runtime categories are not frozen in the chain');
});

test('GB-2 Pivot uses zero for missing SUM/COUNT cells and null for missing AVG cells',()=>{
  const categories=[{value:'A',label:'A',firstSeen:1},{value:'B',label:'B',firstSeen:2}];
  const sum=compileTransformChain(makeChain([pivot()]),{pivotCategories:{'pivot-1':categories}}).steps[0].sql;
  const avg=compileTransformChain(makeChain([pivot({aggregate:'AVG'})]),{pivotCategories:{'pivot-1':categories}}).steps[0].sql;
  const count=compileTransformChain(makeChain([pivot({aggregate:'COUNT',measureField:null})]),{pivotCategories:{'pivot-1':categories}}).steps[0].sql;
  assert.match(sum,/COALESCE\(SUM\(/);
  assert.match(count,/COUNT\(\*\) FILTER/);
  assert.doesNotMatch(avg,/COALESCE\(AVG\(/);
});

test('GB-2 Pivot refuses a 25th category before the pivot SQL is produced',()=>{
  const categories=Array.from({length:25},(_,index)=>({value:`c${index}`,label:`c${index}`,firstSeen:index}));
  const plan=compileTransformChain(makeChain([pivot()]),{pivotCategories:{'pivot-1':categories}});
  assert.equal(plan.steps[0].disabled,true);
  assert.match(plan.steps[0].reason,/at least 25.*limit is 24/i);
  assert.equal(plan.sql,null);
});

test('GB-2 Histogram builds edge-aware bins, retains zero-count rows, and widens equal ranges to one bin',()=>{
  const plan=compileTransformChain(makeChain([{id:'hist-1',op:'histogram',params:{field:'units',bins:5,min:null,max:null}}]));
  assert.deepEqual(plan.columns,['key','value','start','end']);
  assert.match(plan.steps[0].sql,/v\.value < b\.bin_end/);
  assert.match(plan.steps[0].sql,/v\.value <= b\.bin_end/);
  assert.match(plan.steps[0].sql,/LEFT JOIN/);
  assert.match(plan.steps[0].sql,/WHEN \(data_min\) = \(data_max\) THEN 1/);
  assert.equal(plan.steps[0].warning,null);
});

test('GB-2 Histogram flags non-finite or inverted bounds as an empty step and validates the 1–500 bin range',()=>{
  const inverted=compileTransformChain(makeChain([{id:'hist-1',op:'histogram',params:{field:'units',bins:8,min:9,max:2}}]));
  assert.match(inverted.steps[0].warning,/finite.*minimum/i);
  assert.match(inverted.steps[0].sql,/NULL::DOUBLE/);
  const nonFinite=compileTransformChain(makeChain([{id:'hist-1',op:'histogram',params:{field:'units',bins:8,min:Number.POSITIVE_INFINITY,max:10}}]));
  assert.match(nonFinite.steps[0].warning,/finite/);
  for(const bins of [0,501,2.5]) assert.throws(()=>compileTransformChain(makeChain([{id:'hist-1',op:'histogram',params:{field:'units',bins}}])),/integer from 1 to 500/);
});

test('GB-2 Ratio preserves rows, scales optionally, and reports zero and missing denominator paths',()=>{
  const step={id:'ratio-1',op:'ratio',params:{numerator:{kind:'field',field:'signups'},denominator:{kind:'field',field:'visits'},partitions:[],percent:true,outputName:'conversion_pct'}};
  const plan=compileTransformChain(makeChain([step]));
  assert.deepEqual(plan.columns,[...schema.columns,'conversion_pct']);
  assert.match(plan.steps[0].sql,/<> 0 THEN/);
  assert.match(plan.steps[0].sql,/\* 100/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:ratio:denominatorZero/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:ratio:denominatorInvalid/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:ratio:numeratorInvalid/);
});

test('GB-2 Ratio aggregate operands use strict numeric aggregates and optional partitions',()=>{
  const step={id:'ratio-1',op:'ratio',params:{numerator:{kind:'aggregate',column:'signups',operation:'SUM'},denominator:{kind:'aggregate',column:'visits',operation:'SUM'},partitions:['region'],percent:false,outputName:'conversion'}};
  const plan=compileTransformChain(makeChain([step]));
  assert.match(plan.steps[0].sql,/SUM\(CASE WHEN/);
  assert.match(plan.steps[0].sql,/PARTITION BY "region"/);
  assert.match(plan.steps[0].sql,/COALESCE/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:aggregate:signups/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:aggregate:visits/);
});

test('GB-2 histogram bounds remain parameter references in the saved chain contract',()=>{
  const chain=makeChain([{id:'hist-1',op:'histogram',params:{field:'units',bins:10,min:{param:'low'},max:{param:'high'}}}]);
  assert.deepEqual(transformParameterDependencies(chain),['low','high']);
  const plan=compileTransformChain(chain,{parameters:[{name:'low',type:'number',value:0},{name:'high',type:'number',value:20}]});
  assert.equal(plan.steps[0].warning,null);
  assert.deepEqual(plan.chain.steps[0].params.min,{param:'low'});
});
