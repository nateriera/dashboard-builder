import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}
const source=(sql,columns,types,order={kind:'columns',fields:['sequence']})=>({sql,dependencies:[],schema:{columns,types},order});
const envelope=(input,steps,mapping={})=>({version:1,source:input,steps,outputMapping:mapping});
const aggregate=(operation,name,column='amount')=>({column,operation,name});

async function execute(page,chain,parameters=[],sampleOnly=false) {
  return page.evaluate(async ({chain,parameters,sampleOnly})=>{
    const engine=await import('/src/data/duckdb.js');
    const {compileTransformChain}=await import('/src/data/wranglingTransforms.js');
    const {substituteParameters}=await import('/src/data/parameters.js');
    const result=await engine.previewTransformChain(chain,parameters,{sampleOnly});
    const plan=compileTransformChain(chain,{parameters});
    const counts=[];
    for(const step of plan.steps) if(!step.disabled){
      const actual=await engine.runQueryDetailed(substituteParameters(step.sql,parameters));
      counts.push({id:step.id,count:actual.rows.length});
    }
    return {result,counts,sql:plan.sql};
  },{chain,parameters,sampleOnly});
}
function expectCounts(data) {
  for(const step of data.result.steps.filter(step=>!step.disabled)) expect(step.rowsOut).toBe(data.counts.find(actual=>actual.id===step.id).count);
}

test('GA-1 engine: GroupBy counts rows, excludes invalid numeric values and preserves first-seen blank/empty groups', async ({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES
    (1,'B',10::DOUBLE,'tag'), (2,NULL,NULL,NULL),
    (3,'A',CAST('NaN' AS DOUBLE),'x'), (4,'B',5::DOUBLE,'tag'),
    (5,'A',CAST('Infinity' AS DOUBLE),'y'), (6,'',7::DOUBLE,''),
    (7,NULL,NULL,NULL)) AS t(sequence,team,amount,tag)`;
  const chain=envelope(source(sql,['sequence','team','amount','tag'],{sequence:'Int32',team:'Utf8',amount:'Float64',tag:'Utf8'}),[
    {id:'group',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','Total'),aggregate('AVG','Average'),aggregate('MIN','Minimum'),aggregate('MAX','Maximum'),aggregate('COUNT','Rows'),aggregate('COUNT DISTINCT','Distinct tags','tag')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([
    {team:'B',Total:15,Average:7.5,Minimum:5,Maximum:10,Rows:2,'Distinct tags':1},
    {team:'(blank)',Total:0,Average:null,Minimum:null,Maximum:null,Rows:2,'Distinct tags':0},
    {team:'A',Total:0,Average:null,Minimum:null,Maximum:null,Rows:2,'Distinct tags':2},
    {team:'',Total:7,Average:7,Minimum:7,Maximum:7,Rows:1,'Distinct tags':1}
  ]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:7,rowsOut:4,exclusions:{Total:4,Average:4,Minimum:4,Maximum:4,'Distinct tags':2}});
  expect(data.result.steps[0].exclusions).not.toHaveProperty('Rows');
  expectCounts(data);
});

test('GA-1 engine: numeric-looking VARCHAR values remain invalid rather than being coerced', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT * FROM (VALUES (1,'A','2'),(2,'A',''),(3,'A',NULL),(4,'A','junk')) AS t(sequence,team,amount)",['sequence','team','amount'],{sequence:'Int32',team:'Utf8',amount:'Utf8'}),[
    {id:'strict',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','Total'),aggregate('AVG','Average'),aggregate('MIN','Minimum'),aggregate('MAX','Maximum'),aggregate('COUNT','Rows')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([{team:'A',Total:0,Average:null,Minimum:null,Maximum:null,Rows:4}]);
  expect(data.result.steps[0].exclusions).toMatchObject({Total:4,Average:4,Minimum:4,Maximum:4});
  expectCounts(data);
});

test('GA-1 engine: per-partition Bucket gap-fills SUM/COUNT but leaves other measures null and counts bad dates once', async ({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES (1,'A','2026-01-01',10::DOUBLE),(2,'A','2026-01-03',30::DOUBLE),
    (3,'A','not-a-date',99::DOUBLE),(4,'A',NULL,99::DOUBLE),(5,'A','2026-01-03',NULL),
    (6,'B','2026-01-02',8::DOUBLE),(7,'B','2026-01-04',16::DOUBLE)) AS t(sequence,team,date,amount)`;
  const chain=envelope(source(sql,['sequence','team','date','amount'],{sequence:'Int32',team:'Utf8',date:'Utf8',amount:'Float64'},null),[
    {id:'daily',op:'bucket',params:{dateField:'date',grain:'day',partitions:['team'],periodName:'period',aggregations:[aggregate('SUM','Total'),aggregate('COUNT','Rows'),aggregate('AVG','Average'),aggregate('MIN','Minimum'),aggregate('MAX','Maximum')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([
    {team:'A',period:'2026-01-01',Total:10,Rows:1,Average:10,Minimum:10,Maximum:10},
    {team:'A',period:'2026-01-02',Total:0,Rows:0,Average:null,Minimum:null,Maximum:null},
    {team:'A',period:'2026-01-03',Total:30,Rows:2,Average:30,Minimum:30,Maximum:30},
    {team:'B',period:'2026-01-02',Total:8,Rows:1,Average:8,Minimum:8,Maximum:8},
    {team:'B',period:'2026-01-03',Total:0,Rows:0,Average:null,Minimum:null,Maximum:null},
    {team:'B',period:'2026-01-04',Total:16,Rows:1,Average:16,Minimum:16,Maximum:16}
  ]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:7,rowsOut:6,exclusions:{invalidDates:2,Total:1,Average:1,Minimum:1,Maximum:1}});
  expectCounts(data);
});

test('GA-1 engine: AVG/MIN/MAX-only buckets do not fabricate gap rows, and all-invalid dates produce counted empty output', async ({page})=>{
  await ready(page);
  for(const operation of ['AVG','MIN','MAX']){
    const chain=envelope(source("SELECT * FROM (VALUES (1,'2026-01-01',10::DOUBLE),(2,'2026-01-03',30::DOUBLE)) AS t(sequence,date,amount)",['sequence','date','amount'],{sequence:'Int32',date:'Utf8',amount:'Float64'},null),[
      {id:'observed',op:'bucket',params:{dateField:'date',grain:'day',partitions:[],periodName:'period',aggregations:[aggregate(operation,'Value')]}}
    ]);
    const data=await execute(page,chain);
    expect(data.result.rows).toEqual([{period:'2026-01-01',Value:10},{period:'2026-01-03',Value:30}]);
    expectCounts(data);
  }
  const empty=envelope(source("SELECT * FROM (VALUES ('bad',10::DOUBLE),(NULL,20::DOUBLE)) AS t(date,amount)",['date','amount'],{date:'Utf8',amount:'Float64'},null),[
    {id:'empty',op:'bucket',params:{dateField:'date',grain:'day',partitions:[],periodName:'period',aggregations:[aggregate('SUM','Total')]}}
  ]);
  const data=await execute(page,empty);
  expect(data.result.rows).toEqual([]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:2,rowsOut:0,exclusions:{invalidDates:2,Total:0}});
  expectCounts(data);
});

test('GA-1 engine: Sunday belongs to the preceding Monday week without shifting stored wall-clock dates', async ({page})=>{
  await ready(page);
  for(const dateType of ['Utf8','TimestampMillisecond']){
    const expression=dateType==='Utf8'?"value":"CAST(value AS TIMESTAMP)";
    const chain=envelope(source(`SELECT ${expression} AS date, amount FROM (VALUES ('2026-11-08T23:30:00-07:00',2::DOUBLE),('2026-11-09T00:30:00-07:00',3::DOUBLE)) AS t(value,amount)`,['date','amount'],{date:dateType,amount:'Float64'},null),[
      {id:'weeks',op:'bucket',params:{dateField:'date',grain:'week',partitions:[],periodName:'period',aggregations:[aggregate('SUM','Total')]}}
    ]);
    const data=await execute(page,chain);
    expect(data.result.rows).toEqual([{period:'2026-11-02',Total:2},{period:'2026-11-09',Total:3}]);
    expectCounts(data);
  }
});

test('GA-1 engine: grain parameter references remain raw and re-execution uses current values', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT date, amount + CAST({{increment}} AS DOUBLE) AS amount FROM (VALUES ('2026-01-01',10::DOUBLE),('2026-01-03',30::DOUBLE),('2026-03-02',5::DOUBLE)) AS t(date,amount)",['date','amount'],{date:'Utf8',amount:'Float64'},null),[
    {id:'periods',op:'bucket',params:{dateField:'date',grain:{param:'grain'},partitions:[],periodName:'period',aggregations:[aggregate('SUM','Total')]}}
  ]);
  const before=structuredClone(chain);
  const monthly=await execute(page,chain,[{name:'grain',type:'text',value:'month'},{name:'increment',type:'number',value:0}]);
  expect(monthly.result.rows).toEqual([{period:'2026-01',Total:40},{period:'2026-02',Total:0},{period:'2026-03',Total:5}]);
  const daily=await execute(page,chain,[{name:'grain',type:'text',value:'day'},{name:'increment',type:'number',value:1}]);
  expect(daily.result.rows).toHaveLength(61);
  expect(daily.result.rows[0]).toEqual({period:'2026-01-01',Total:11});
  expect(daily.result.rows.at(-1)).toEqual({period:'2026-03-02',Total:6});
  expect(monthly.sql).toBe(daily.sql);
  expect(monthly.sql).toContain('{{grain}}');expect(monthly.sql).toContain('{{increment}}');
  expect(chain).toEqual(before);expectCounts(monthly);expectCounts(daily);
});

test('GA-1 engine: preview samples at most five rows while every step reports its actual full SQL count', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT i AS sequence, 'Team ' || CAST(i % 7 AS VARCHAR) AS team, CAST(i AS DOUBLE) AS amount FROM range(0,21) AS t(i)",['sequence','team','amount'],{sequence:'Int64',team:'Utf8',amount:'Float64'}),[
    {id:'teams',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','Total')]}},
    {id:'all',op:'groupBy',params:{groups:[],aggregations:[aggregate('SUM','Grand total','Total')]}}
  ]);
  const data=await execute(page,chain,[],true);
  expect(data.result.rows.length).toBeLessThanOrEqual(5);
  expect(data.result.rows).toEqual([{'Grand total':210}]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:21,rowsOut:7});
  expect(data.result.steps[1]).toMatchObject({rowsIn:7,rowsOut:1});
  expectCounts(data);
  const firstOnly=await execute(page,{...chain,steps:[chain.steps[0]]},[],true);
  expect(firstOnly.result.rows).toHaveLength(5);expect(firstOnly.result.steps[0].rowsOut).toBe(7);expectCounts(firstOnly);
});

test('GA-1 engine: a downstream SUM of derived integer COUNT values remains an exact numeric count', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT * FROM (VALUES (1,'A'),(2,'A'),(3,'B'),(4,'C'),(5,'C'),(6,'C')) AS t(sequence,team)",['sequence','team'],{sequence:'Int32',team:'Utf8'}),[
    {id:'counts',op:'groupBy',params:{groups:['team'],aggregations:[{operation:'COUNT',name:'Rows'}]}},
    {id:'total',op:'groupBy',params:{groups:[],aggregations:[aggregate('SUM','Total rows','Rows')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([{'Total rows':6}]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:6,rowsOut:3});
  expect(data.result.steps[1]).toMatchObject({rowsIn:3,rowsOut:1,exclusions:{'Total rows':0}});
  expectCounts(data);
});

test('GA-1 engine: ambiguous explicit ordering disables GroupBy until a real tie-break field is supplied', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT * FROM (VALUES (1,'A',2::DOUBLE),(1,'B',3::DOUBLE)) AS t(sequence,team,amount)",['sequence','team','amount'],{sequence:'Int32',team:'Utf8',amount:'Float64'}),[
    {id:'ordered',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','Total')]}}
  ]);
  const disabled=await page.evaluate(async chain=>(await import('/src/data/duckdb.js')).previewTransformChain(chain,[],{sampleOnly:false}),chain);
  expect(disabled.sql).toBeNull();
  expect(disabled.rows).toEqual([]);
  expect(disabled.steps[0].disabled).toBe(true);
  expect(disabled.steps[0].reason).toMatch(/uniqu|tie.break|deterministic|order/i);
  expect(disabled.errors.length).toBeGreaterThan(0);
  chain.source.order={kind:'columns',fields:['sequence','team']};
  const enabled=await execute(page,chain);
  expect(enabled.result.steps[0].disabled).toBe(false);
  expect(enabled.result.sql).toEqual(expect.any(String));
  expect(enabled.result.rows).toEqual([{team:'A',Total:2},{team:'B',Total:3}]);
  expectCounts(enabled);
});

test('GA-1 engine: bucket partitions and output names cannot collide with lo/hi or compiler-looking identifiers', async ({page})=>{
  await ready(page);
  const partitioned=envelope(source("SELECT * FROM (VALUES ('2026-01-01','North','Web','kept period','kept ordinal',2::DOUBLE),('2026-01-03','North','Web','kept period','kept ordinal',4::DOUBLE)) AS t(date,lo,hi,__transform_period,__transform_ordinal,amount)",['date','lo','hi','__transform_period','__transform_ordinal','amount'],{date:'Utf8',lo:'Utf8',hi:'Utf8',__transform_period:'Utf8',__transform_ordinal:'Utf8',amount:'Float64'},null),[
    {id:'partitions',op:'bucket',params:{dateField:'date',grain:'day',partitions:['lo','hi','__transform_period','__transform_ordinal'],periodName:'period',aggregations:[aggregate('SUM','Total')]}}
  ]);
  const first=await execute(page,partitioned);
  const keys={lo:'North',hi:'Web',__transform_period:'kept period',__transform_ordinal:'kept ordinal'};
  expect(first.result.rows).toEqual([
    {...keys,period:'2026-01-01',Total:2},
    {...keys,period:'2026-01-02',Total:0},
    {...keys,period:'2026-01-03',Total:4}
  ]);
  expectCounts(first);
  const named=envelope(source("SELECT * FROM (VALUES ('North','2026-01-01',2::DOUBLE),('North','2026-01-03',4::DOUBLE)) AS t(team,date,amount)",['team','date','amount'],{team:'Utf8',date:'Utf8',amount:'Float64'},null),[
    {id:'names',op:'bucket',params:{dateField:'date',grain:'day',partitions:['team'],periodName:'__transform_period',aggregations:[aggregate('SUM','lo'),aggregate('COUNT','hi'),aggregate('AVG','__transform_ordinal')]}}
  ]);
  const second=await execute(page,named);
  expect(second.result.rows).toEqual([
    {team:'North',__transform_period:'2026-01-01',lo:2,hi:1,__transform_ordinal:2},
    {team:'North',__transform_period:'2026-01-02',lo:0,hi:0,__transform_ordinal:null},
    {team:'North',__transform_period:'2026-01-03',lo:4,hi:1,__transform_ordinal:4}
  ]);
  expectCounts(second);
});

test('GA-1 engine: an aggregate named invalidDates retains separate aggregate and bad-date provenance', async ({page})=>{
  await ready(page);
  const chain=envelope(source("SELECT * FROM (VALUES ('2026-01-01',NULL::DOUBLE),('2026-01-03',2::DOUBLE),('bad',10::DOUBLE),(NULL,10::DOUBLE)) AS t(date,amount)",['date','amount'],{date:'Utf8',amount:'Float64'},null),[
    {id:'collision',op:'bucket',params:{dateField:'date',grain:'day',partitions:[],periodName:'period',aggregations:[aggregate('SUM','invalidDates')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([{period:'2026-01-01',invalidDates:0},{period:'2026-01-02',invalidDates:0},{period:'2026-01-03',invalidDates:2}]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:4,rowsOut:3});
  expect(data.result.steps[0].provenance).toHaveLength(2);
  expect(data.result.steps[0].provenance).toEqual(expect.arrayContaining([
    {kind:'aggregate',name:'invalidDates',count:1},
    {kind:'invalidDates',count:2}
  ]));
  expectCounts(data);
});

test('GA-1 engine: stored schema drift cannot turn a fractional SUM into a rounded integer', async ({page})=>{
  await ready(page);
  const chain=envelope(source('SELECT 1.25::DOUBLE AS amount',['amount'],{amount:'Int32'},null),[
    {id:'total',op:'groupBy',params:{groups:[],aggregations:[aggregate('SUM','Total')]}}
  ]);
  const outcome=await page.evaluate(async chain=>{
    try {return {rows:(await (await import('/src/data/duckdb.js')).previewTransformChain(chain,[],{sampleOnly:false,refreshSchema:false})).rows};}
    catch(error){return {error:error.message};}
  },chain);
  expect(outcome.error).toMatch(/schema changed|preview again/i);
  const refreshed=await execute(page,chain);
  expect(refreshed.result.rows).toEqual([{Total:1.25}]);
});

test('GA-1 engine: a global GroupBy over empty input returns SUM/COUNT zero and AVG/MIN/MAX null', async ({page})=>{
  await ready(page);
  const chain=envelope(source('SELECT NULL::DOUBLE AS amount WHERE FALSE',['amount'],{amount:'Float64'},null),[
    {id:'empty',op:'groupBy',params:{groups:[],aggregations:['SUM','COUNT','AVG','MIN','MAX'].map(operation=>aggregate(operation,operation))}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([{SUM:0,COUNT:0,AVG:null,MIN:null,MAX:null}]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:0,rowsOut:1,exclusions:{SUM:0,AVG:0,MIN:0,MAX:0}});
  expectCounts(data);
});

test('GA-1 engine: integer MIN/MAX output retains its type for a downstream SUM', async ({page})=>{
  await ready(page);
  for(const operation of ['MIN','MAX']) {
    const chain=envelope(source("SELECT * FROM (VALUES (1,'A',2),(2,'A',3),(3,'B',5)) AS t(sequence,team,amount)",['sequence','team','amount'],{sequence:'Int32',team:'Utf8',amount:'Int32'}),[
      {id:'extrema',op:'groupBy',params:{groups:['team'],aggregations:[aggregate(operation,'Extreme')]}},
      {id:'total',op:'groupBy',params:{groups:[],aggregations:[aggregate('SUM','Total','Extreme')]}}
    ]);
    const data=await execute(page,chain);
    expect(data.result.rows).toEqual([{Total:operation==='MIN'?7:8}]);
    expectCounts(data);
  }
});

test('GA-1 engine: registered upload source ordinals preserve first-seen group order', async ({page})=>{
  await ready(page);
  const id=await page.evaluate(async()=>{
    const {saveDataset}=await import('/src/data/store.js');
    return saveDataset({name:'Ordered upload',columns:['team','amount'],rows:[{team:'B',amount:2},{team:'A',amount:4},{team:'B',amount:3}],fieldKeys:[],mapping:{}}).id;
  });
  const chain=envelope({table:`upload_${id}`,dependencies:[`upload:${id}`],schema:{columns:['team','amount'],types:{team:'Utf8',amount:'Float64'}},order:{kind:'sourceOrdinal'}},[
    {id:'group',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','Total')]}}
  ]);
  const data=await execute(page,chain);
  expect(data.result.rows).toEqual([{team:'B',Total:5},{team:'A',Total:4}]);
  expectCounts(data);
});
