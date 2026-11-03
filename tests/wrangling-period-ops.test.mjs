import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTransformChain, transformParameterDependencies, validateTransformChain } from '../src/data/wranglingTransforms.js';

const source={sql:'SELECT sequence, team, day, amount, current_value, previous_value FROM fixture WHERE {{factor}} > 0',dependencies:[],schema:{columns:['sequence','team','day','amount','current_value','previous_value'],types:{sequence:'Int32',team:'Utf8',day:'Utf8',amount:'Float64',current_value:'Float64',previous_value:'Float64'}},order:{kind:'columns',fields:['sequence']}};
const chain=steps=>({version:1,source:structuredClone(source),steps,outputMapping:{}});
const parameters=[{name:'factor',type:'number',value:2},{name:'days',type:'number',value:30},{name:'start',type:'text',value:'2026-01-01'},{name:'end',type:'text',value:'2026-01-31'}];

test('GB-1 validates Cumulative, Change, and same-source periodPair contracts and retains window references',()=>{
  const input=chain([
    {id:'running',op:'cumulative',params:{field:'amount',partitions:['team']}},
    {id:'change',op:'change',params:{currentField:'current_value',previousField:'previous_value',outputName:'change_pct'}},
    {id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:{param:'days'}},outputCurrent:'current',outputPrevious:'previous'}}
  ]);
  const validated=validateTransformChain(input,{parameters});
  assert.deepEqual(validated.steps.map(step=>step.op),['cumulative','change','periodPair']);
  assert.deepEqual(validated.steps[2].params.currentWindow.days,{param:'days'});
  assert.deepEqual(transformParameterDependencies(validated).sort(),['days','factor']);
  assert.deepEqual(input.steps[2].params.currentWindow.days,{param:'days'});
  assert.throws(()=>validateTransformChain(chain([{id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:30},previousSource:'other_table'}}])),/periodPair/i);
});

test('Cumulative uses an explicit ordered ROWS frame, partitions, carries invalids, and counts them',()=>{
  const plan=compileTransformChain(chain([{id:'running',op:'cumulative',params:{field:'amount',partitions:['team']}}]));
  assert.equal(plan.steps[0].disabled,false);
  assert.deepEqual(plan.columns,['sequence','team','day','amount','current_value','previous_value']);
  assert.match(plan.steps[0].sql,/SUM\(CASE WHEN .*isfinite\("amount"\).* THEN CAST\("amount" AS DOUBLE\) ELSE 0::DOUBLE END\) OVER \(PARTITION BY "team" ORDER BY "__transform_ordinal" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\)/i);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:invalidValues/);
});

test('Change follows the spec percent formula and reports each null cause separately',()=>{
  const plan=compileTransformChain(chain([{id:'change',op:'change',params:{currentField:'current_value',previousField:'previous_value',outputName:'change_pct'}}]));
  assert.equal(plan.steps[0].disabled,false);
  assert.deepEqual(plan.columns,[...source.schema.columns,'change_pct']);
  assert.match(plan.steps[0].sql,/\(\("current_value"\s*-\s*"previous_value"\)\s*\/\s*abs\("previous_value"\)\)\s*\*\s*100/i);
  assert.match(plan.steps[0].sql,/"previous_value"\s*<>\s*0/i);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:change:previousZero/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:change:previousInvalid/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:change:currentInvalid/);
});

test('periodPair defaults the preceding relative window and uses an execution-date marker',()=>{
  const plan=compileTransformChain(chain([{id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:{param:'days'}},outputCurrent:'current',outputPrevious:'previous'}}]),{parameters});
  assert.equal(plan.steps[0].disabled,false);
  assert.deepEqual(plan.columns,['team','current','previous']);
  assert.match(plan.sql,/__DASHBOARD_BUILDER_APP_LOCAL_DATE__/);
  assert.match(plan.sql,/CAST\(\{\{days\}\} AS BIGINT\)/i);
  assert.match(plan.steps[0].sql,/COALESCE\(/i);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:invalidDates/);
  assert.match(plan.steps[0].diagnosticsSql,/excluded:aggregate/);
});

test('periodPair emits inclusive explicit date windows, preserves AVG nulls, and supports COUNT defaults',()=>{
  const averaged=compileTransformChain(chain([{id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'AVG',currentWindow:{kind:'range',start:{param:'start'},end:{param:'end'}},outputCurrent:'current',outputPrevious:'previous'}}]),{parameters});
  assert.match(averaged.sql,/TRY_CAST\("day" AS DATE\)\s*>=\s*TRY_CAST\('\{\{start\}\}' AS DATE\)/i);
  assert.doesNotMatch(averaged.sql,/COALESCE\([^)]*"current"/i);
  const counted=compileTransformChain(chain([{id:'pair',op:'periodPair',params:{dateField:'day',categoryField:null,measureField:'amount',aggregate:'COUNT',currentWindow:{kind:'relative',days:7},outputCurrent:'current',outputPrevious:'previous'}}]));
  assert.match(counted.sql,/COUNT\(\*\).*FILTER/i);
  assert.deepEqual(counted.columns,['current','previous']);
});

test('order-sensitive GB-1 steps require deterministic input order and guard ambiguous order fields',()=>{
  for(const [op,params] of [['cumulative',{field:'amount',partitions:[]}],['periodPair',{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:7},outputCurrent:'current',outputPrevious:'previous'}]]) {
    const input=chain([{id:op,op,params}]);input.source.order=null;
    const plan=compileTransformChain(input);
    assert.equal(plan.steps[0].disabled,true);
    assert.match(plan.steps[0].reason,/deterministic.*order/i);
  }
  const grouped=chain([{id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:7},outputCurrent:'current',outputPrevious:'previous'}}]);
  assert.equal(compileTransformChain(grouped).guards[0].stepId,'pair');
});
