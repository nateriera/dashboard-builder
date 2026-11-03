import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransformChain, compileTransformChain } from '../src/data/wranglingTransforms.js';

const schema = {columns:['sequence','team','amount','date'],types:{sequence:'Int32',team:'Utf8',amount:'Float64',date:'Utf8'}};
const source = () => ({table:'upload_source',dependencies:['upload:source'],schema:structuredClone(schema),order:{kind:'sourceOrdinal'}});
const group = (id='group') => ({id,op:'groupBy',params:{groups:['team'],aggregations:[{column:'amount',operation:'SUM',name:'Total'}]}});
const chain = (steps=[group()]) => ({version:1,source:source(),steps,outputMapping:{label:'team',value:'Total'}});

test('chain validation preserves raw source placeholders, literal/reference params, and caller data', () => {
  const input=chain([{id:'bucket',op:'bucket',params:{dateField:'date',grain:{param:'grain'},partitions:['team'],aggregations:[{column:'amount',operation:'SUM',name:'Total'}],periodName:'period'}}]);
  input.source={sql:'SELECT {{label}} AS team, CAST({{amount}} AS DOUBLE) AS amount, \'2026-01-01\' AS date',dependencies:[],schema:{columns:['team','amount','date'],types:{team:'Utf8',amount:'Float64',date:'Utf8'}},order:null};
  input.outputMapping={date:'period',value:'Total',series:'team'};
  const before=structuredClone(input);
  const parameters=[{name:'grain',type:'text',value:'month'},{name:'label',type:'text',value:'{{amount}}'},{name:'amount',type:'number',value:2}];
  const validated=validateTransformChain(input,{parameters});
  const plan=compileTransformChain(validated,{parameters});
  assert.deepEqual(input,before);
  assert.deepEqual(validated.steps[0].params.grain,{param:'grain'});
  assert.equal(validated.source.sql,before.source.sql);
  assert.match(plan.sql,/\{\{grain\}\}/);
  assert.match(plan.sql,/\{\{label\}\}/);
  assert.match(plan.sql,/\{\{amount\}\}/);
  assert.deepEqual(new Set(plan.parameterDependencies),new Set(['grain','label','amount']));
  assert.deepEqual(plan.columns,['team','period','Total']);
});

test('chain validation rejects malformed versions, ambiguous sources, duplicate steps, and unavailable ops', () => {
  const invalid=[
    {...chain(),version:99},
    {...chain(),source:{...source(),sql:'SELECT 1'}},
    {...chain(),source:{...source(),table:{param:'tableName'}}},
    chain([group('same'),group('same')]),
    chain([{id:'gate-b',op:'pivot',params:{rows:['team']}}])
  ];
  for(const input of invalid) assert.throws(()=>validateTransformChain(input));
});

test('parameter names must refer to validated existing parameters and never act as identifiers', () => {
  const input=chain([{id:'bucket',op:'bucket',params:{dateField:'date',grain:{param:'grain'},partitions:[],aggregations:[{operation:'COUNT',name:'Rows'}],periodName:'period'}}]);
  input.outputMapping={date:'period',value:'Rows'};
  assert.throws(()=>validateTransformChain(input,{parameters:[]}),/parameter|grain/i);
  assert.throws(()=>validateTransformChain(input,{parameters:[{name:'grain',type:'number',value:1}]}),/parameter|grain|text/i);
  assert.throws(()=>validateTransformChain({...input,steps:[{...input.steps[0],params:{...input.steps[0].params,dateField:{param:'field'}}}]}),/column|field|date|identifier/i);
});

test('groupBy defaults to SUM with a value field and row COUNT without one', () => {
  const input=chain([{id:'group',op:'groupBy',params:{groups:['team'],aggregations:[{column:'amount',name:'Total'},{name:'Rows'}]}}]);
  const plan=compileTransformChain(input);
  assert.equal(plan.steps[0].disabled,false);
  assert.deepEqual(plan.chain.steps[0].params.aggregations.map(aggregate=>aggregate.operation),['SUM','COUNT']);
  assert.deepEqual(plan.columns,['team','Total','Rows']);
});

test('first-seen grouped output requires declared order while a global aggregate does not invent one', () => {
  const input=chain();input.source={...source(),sql:'SELECT sequence, team, amount, date FROM raw_source',order:null};delete input.source.table;
  const disabled=compileTransformChain(input);
  assert.equal(disabled.sql,null);
  assert.equal(disabled.steps[0].disabled,true);
  assert.match(disabled.steps[0].reason,/deterministic|order/i);
  input.source.order={kind:'columns',fields:['sequence']};
  assert.equal(compileTransformChain(input).steps[0].disabled,false);
  input.source.order=null;input.steps[0].params.groups=[];input.outputMapping={value:'Total'};
  assert.equal(compileTransformChain(input).steps[0].disabled,false);
});

test('reordering revalidates downstream fields and retains an explicit disabled step instead of dropping it', () => {
  const first={id:'totals',op:'groupBy',params:{groups:['date'],aggregations:[{column:'amount',operation:'SUM',name:'Total'}]}};
  const second={id:'final',op:'groupBy',params:{groups:['date'],aggregations:[{column:'Total',operation:'SUM',name:'Final'}]}};
  const input=chain([first,second]);input.outputMapping={label:'date',value:'Final'};
  const valid=compileTransformChain(input);
  assert.equal(valid.steps.some(step=>step.disabled),false);
  const reversed=compileTransformChain({...input,steps:[second,first]});
  assert.equal(reversed.steps.length,2);
  assert.equal(reversed.steps[0].disabled,true);
  assert.match(reversed.steps[0].reason,/Total/);
  assert.equal(reversed.sql,null);
});

test('bucket supports day/week/month and disables incompatible incoming date columns', () => {
  for(const grain of ['day','week','month']){
    const input=chain([{id:'bucket',op:'bucket',params:{dateField:'date',grain,partitions:[],aggregations:[{operation:'COUNT',name:'Rows'}],periodName:'period'}}]);
    input.outputMapping={date:'period',value:'Rows'};
    assert.equal(compileTransformChain(input).steps[0].disabled,false);
    const incompatible=structuredClone(input);incompatible.steps[0].params.dateField='amount';
    assert.equal(compileTransformChain(incompatible).steps[0].disabled,true);
  }
});

test('compiler quotes user identifiers and never exposes its internal ordinal as an output column', () => {
  const input=chain([{id:'group',op:'groupBy',params:{groups:['group name'],aggregations:[{column:'gross"sales',operation:'SUM',name:'Total "quoted"'}]}}]);
  input.source={table:'upload_odd"name',dependencies:[],schema:{columns:['group name','gross"sales','__db_chain_ordinal'],types:{'group name':'Utf8','gross"sales':'Float64',__db_chain_ordinal:'Int32'}},order:{kind:'sourceOrdinal'}};
  input.outputMapping={label:'group name',value:'Total "quoted"'};
  const plan=compileTransformChain(input);
  assert.match(plan.sql,/"upload_odd""name"/);
  assert.match(plan.sql,/"gross""sales"/);
  assert.match(plan.sql,/"Total ""quoted"""/);
  assert.deepEqual(plan.columns,['group name','Total "quoted"']);
});

test('raw SQL is one validated source statement and its optional terminator never escapes a CTE', () => {
  const input=chain();delete input.source.table;
  input.source.sql='SELECT 1 AS sequence, \'A\' AS team, CAST({{amount}} AS DOUBLE) AS amount; \n';
  input.source.order={kind:'columns',fields:['sequence']};
  const plan=compileTransformChain(input,{parameters:[{name:'amount',type:'number',value:2}]});
  assert.match(plan.sql,/\{\{amount\}\}/);
  assert.doesNotMatch(plan.sql,/;\s*\)/);
  assert.throws(()=>validateTransformChain({...input,source:{...input.source,sql:'SELECT 1); DROP TABLE source; --'}}),/statement|parenthes|SQL|query/i);
});
