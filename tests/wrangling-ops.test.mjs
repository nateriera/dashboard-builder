import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTransformChain, transformParameterDependencies, validateTransformChain } from '../src/data/wranglingTransforms.js';

const source={sql:'SELECT sequence, team, amount, ticket_date FROM fixture',dependencies:[],schema:{columns:['sequence','team','amount','ticket_date'],types:{sequence:'Int32',team:'Utf8',amount:'Float64',ticket_date:'Utf8'}},order:{kind:'columns',fields:['sequence']}};
const chain=steps=>({version:1,source:structuredClone(source),steps,outputMapping:{}});
const params=[{name:'lower',type:'number',value:2},{name:'upper',type:'number',value:8},{name:'cutoff',type:'text',value:'2026-01-01'},{name:'limit',type:'number',value:3},{name:'window',type:'number',value:4}];

test('GA-2 validates Between, Top, MovingAvg, and Stats contracts and keeps parameter references',()=>{
  const input=chain([
    {id:'numeric-range',op:'between',params:{field:'amount',mode:'numeric',lower:{param:'lower'},upper:{param:'upper'}}},
    {id:'date-range',op:'between',params:{field:'ticket_date',mode:'date',lower:{param:'cutoff'},upper:'2026-12-31'}},
    {id:'rank',op:'top',params:{field:'amount',n:{param:'limit'},direction:'asc'}},
    {id:'average',op:'movingAvg',params:{field:'amount',window:{param:'window'},partitions:['team']}},
    {id:'summary',op:'stats',params:{field:'amount'}}
  ]);
  const validated=validateTransformChain(input,{parameters:params});
  assert.deepEqual(validated.steps.map(step=>step.op),['between','between','top','movingAvg','stats']);
  assert.deepEqual(transformParameterDependencies(validated).sort(),['cutoff','limit','lower','upper','window']);
  assert.deepEqual(validated.steps[0].params.lower,{param:'lower'});
  assert.equal(validated.steps[2].params.direction,'asc');
});

test('Between compiles numeric comparisons separately from date parsing and keeps inclusive bounds',()=>{
  const numeric=compileTransformChain(chain([{id:'number',op:'between',params:{field:'amount',mode:'numeric',lower:2,upper:8}}]));
  const date=compileTransformChain(chain([{id:'date',op:'between',params:{field:'ticket_date',mode:'date',lower:'2026-01-01',upper:'2026-12-31'}}]));
  assert.equal(numeric.steps[0].disabled,false);
  assert.match(numeric.steps[0].sql,/isfinite\("amount"\)/i);
  assert.match(numeric.steps[0].sql,/>=\s*2[\s\S]*<=\s*8/);
  assert.match(date.steps[0].sql,/TRY_CAST\("ticket_date" AS TIMESTAMP\)/);
  assert.match(date.steps[0].sql,/>=\s*TRY_CAST\('2026-01-01' AS TIMESTAMP\)[\s\S]*<=\s*TRY_CAST\('2026-12-31' AS TIMESTAMP\)/);
});

test('Between inverted bounds and type-incompatible parameter references compile to flagged empty steps',()=>{
  const inverted=compileTransformChain(chain([{id:'inverted',op:'between',params:{field:'amount',mode:'numeric',lower:9,upper:2}}]));
  assert.match(inverted.steps[0].warning,/lower.*upper|inverted/i);
  assert.match(inverted.steps[0].sql,/WHERE FALSE/i);
  const incompatible=compileTransformChain(chain([{id:'wrong-type',op:'between',params:{field:'ticket_date',mode:'date',lower:{param:'lower'},upper:'2026-12-31'}}]),{parameters:params});
  assert.match(incompatible.steps[0].warning,/text|date|parameter/i);
  assert.match(incompatible.steps[0].sql,/WHERE FALSE/i);
});

test('Top preserves explicit direction, stable ordinal ties, and has no chart-category cap',()=>{
  const plan=compileTransformChain(chain([{id:'rank',op:'top',params:{field:'amount',n:150,direction:'desc'}}]));
  assert.equal(plan.steps[0].disabled,false);
  assert.match(plan.steps[0].sql,/ORDER BY "amount" DESC, "__transform_ordinal" ASC/i);
  assert.match(plan.steps[0].sql,/LIMIT 150/);
  const invalid=compileTransformChain(chain([{id:'bad-limit',op:'top',params:{field:'amount',n:0,direction:'asc'}}]));
  assert.match(invalid.steps[0].warning,/integer.*at least 1|N/i);
  assert.match(invalid.steps[0].sql,/WHERE FALSE/i);
});

test('MovingAvg uses a trailing present-row frame, optional partitions, and replaces its field',()=>{
  const plan=compileTransformChain(chain([{id:'rolling',op:'movingAvg',params:{field:'amount',window:3,partitions:['team']}}]));
  assert.deepEqual(plan.columns,['sequence','team','amount','ticket_date']);
  assert.match(plan.steps[0].sql,/AVG\(CASE WHEN \("amount" IS NOT NULL AND isfinite\("amount"\)\) THEN "amount" END\) OVER \(PARTITION BY "team" ORDER BY "__transform_ordinal" ROWS BETWEEN 2 PRECEDING AND CURRENT ROW\)/i);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:invalidValues/);
});

test('Stats emits one fixed output row shape with a valid-value count, median, and population deviation',()=>{
  const plan=compileTransformChain(chain([{id:'statistics',op:'stats',params:{field:'amount'}}]));
  assert.deepEqual(plan.columns,['count','min','max','mean','median','stddev']);
  assert.match(plan.steps[0].sql,/COUNT\(CASE WHEN/);
  assert.match(plan.steps[0].sql,/MEDIAN\(/i);
  assert.match(plan.steps[0].sql,/STDDEV_POP\(/i);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:invalidValues/);
});

test('order-sensitive GA-2 steps are disabled without declared ordering and guard duplicate order fields',()=>{
  for(const op of ['top','movingAvg']) {
    const params=op==='top'?{field:'amount',n:2,direction:'desc'}:{field:'amount',window:2,partitions:[]};
    const unordered=chain([{id:op,op,params}]);unordered.source.order=null;
    const plan=compileTransformChain(unordered);
    assert.equal(plan.steps[0].disabled,true);
    assert.match(plan.steps[0].reason,/deterministic.*order/i);
    assert.equal(plan.sql,null);
  }
  const ambiguous=chain([{id:'rolling',op:'movingAvg',params:{field:'amount',window:2,partitions:[]}}]);
  ambiguous.source.order={kind:'columns',fields:['team']};
  assert.equal(compileTransformChain(ambiguous).guards[0].stepId,'rolling');
});

test('parameterized operation SQL stays unresolved and parameter values remain separate from chain state',()=>{
  const input=chain([
    {id:'windowed',op:'movingAvg',params:{field:'amount',window:{param:'window'},partitions:[]}},
    {id:'ranked',op:'top',params:{field:'amount',n:{param:'limit'},direction:'desc'}}
  ]);
  const before=structuredClone(input),plan=compileTransformChain(input,{parameters:params});
  assert.match(plan.sql,/ROWS BETWEEN \(\{\{window\}\} - 1\) PRECEDING/);
  assert.match(plan.sql,/LIMIT \{\{limit\}\}/);
  assert.deepEqual(input,before);
  assert.deepEqual(plan.parameterDependencies.sort(),['limit','window']);
});
