import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}
const source=(sql,columns,types,order={kind:'columns',fields:['sequence']})=>({sql,dependencies:[],schema:{columns,types},order});
const chain=(input,steps)=>({version:1,source:input,steps,outputMapping:{}});
const aggregate=(operation,name,column='amount')=>({column,operation,name});
async function execute(page,chain,parameters=[]) {
  return page.evaluate(async ({chain,parameters})=>{
    const engine=await import('/src/data/duckdb.js');
    const {compileTransformChain}=await import('/src/data/wranglingTransforms.js');
    const {substituteParameters}=await import('/src/data/parameters.js');
    const result=await engine.previewTransformChain(chain,parameters,{sampleOnly:false});
    const plan=compileTransformChain(chain,{parameters}),counts=[];
    for(const step of plan.steps)if(!step.disabled){
      const rows=await engine.runQueryDetailed(substituteParameters(step.sql,parameters));
      counts.push({id:step.id,count:rows.rows.length});
    }
    return {result,counts};
  },{chain,parameters});
}
function expectStepCounts(data) {
  for(const step of data.result.steps.filter(item=>!item.disabled))expect(step.rowsOut).toBe(data.counts.find(item=>item.id===step.id).count);
}

test('GA-2 Between uses inclusive numeric and explicit date paths, counts invalids, warns on inversion, and flags incompatible refs',async({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES
    (0,1::DOUBLE,'2026-01-01'),(1,2::DOUBLE,'2026-01-02'),(2,3::DOUBLE,'2026-01-03'),
    (3,9::DOUBLE,'bad-date'),(4,NULL::DOUBLE,NULL),(5,CAST('NaN' AS DOUBLE),'2026-01-05')
  ) AS t(sequence,amount,ticket_date)`;
  const input=source(sql,['sequence','amount','ticket_date'],{sequence:'Int32',amount:'Float64',ticket_date:'Utf8'});
  const numeric=await execute(page,chain(input,[{id:'numeric',op:'between',params:{field:'amount',mode:'numeric',lower:2,upper:3}}]));
  expect(numeric.result.rows.map(row=>row.sequence)).toEqual([1,2]);
  expect(numeric.result.steps[0]).toMatchObject({rowsIn:6,rowsOut:2,exclusions:{amount:2}});
  const dates=await execute(page,chain(input,[{id:'date',op:'between',params:{field:'ticket_date',mode:'date',lower:'2026-01-02',upper:'2026-01-03'}}]));
  expect(dates.result.rows.map(row=>row.sequence)).toEqual([1,2]);
  expect(dates.result.steps[0].exclusions.ticket_date).toBe(2);
  const inverted=await execute(page,chain(input,[{id:'inverted',op:'between',params:{field:'amount',mode:'numeric',lower:8,upper:2}}]));
  expect(inverted.result.rows).toEqual([]);
  expect(inverted.result.errors).toEqual([]);
  expect(inverted.result.steps[0].warning).toMatch(/exceeds|empty/i);
  const incompatible=await execute(page,chain(input,[{id:'wrong-type',op:'between',params:{field:'ticket_date',mode:'date',lower:{param:'low'},upper:'2026-01-31'}}]),[{name:'low',type:'number',value:1}]);
  expect(incompatible.result.rows).toEqual([]);
  expect(incompatible.result.steps[0].warning).toMatch(/text|parameter|incompatible/i);
  for(const data of [numeric,dates,inverted,incompatible])expectStepCounts(data);
});

test('GA-2 Top excludes invalid values, ranks in either direction, breaks ties by input order, and exceeds 100 rows',async({page})=>{
  await ready(page);
  const input=source("SELECT * FROM (VALUES (0,'A',10::DOUBLE),(1,'B',10::DOUBLE),(2,'C',5::DOUBLE),(3,'D',1::DOUBLE),(4,'E',NULL::DOUBLE),(5,'F',CAST('NaN' AS DOUBLE))) AS t(sequence,team,duration)",['sequence','team','duration'],{sequence:'Int32',team:'Utf8',duration:'Float64'});
  const descending=await execute(page,chain(input,[{id:'top',op:'top',params:{field:'duration',n:3,direction:'desc'}}]));
  expect(descending.result.rows.map(row=>row.sequence)).toEqual([0,1,2]);
  expect(descending.result.steps[0]).toMatchObject({rowsIn:6,rowsOut:3,exclusions:{duration:2}});
  const ascending=await execute(page,chain(input,[{id:'top',op:'top',params:{field:'duration',n:2,direction:'asc'}}]));
  expect(ascending.result.rows.map(row=>row.sequence)).toEqual([3,2]);
  const many=source('SELECT i AS sequence,CAST(i AS DOUBLE) AS amount FROM range(0,120) t(i)',['sequence','amount'],{sequence:'Int64',amount:'Float64'});
  const uncapped=await execute(page,chain(many,[{id:'uncapped',op:'top',params:{field:'amount',n:120,direction:'desc'}}]));
  expect(uncapped.result.rows).toHaveLength(120);
  expect(uncapped.result.rows[0].amount).toBe(119);
  for(const data of [descending,ascending,uncapped])expectStepCounts(data);
});

test('GA-2 MovingAvg ignores invalid samples, preserves every row, partitions, and uses present rows only',async({page})=>{
  await ready(page);
  const input=source("SELECT * FROM (VALUES (0,'A','2026-01-01',10::DOUBLE),(1,'A','2026-01-03',NULL::DOUBLE),(2,'A','2026-01-04',CAST('NaN' AS DOUBLE)),(3,'A','2026-01-05',4::DOUBLE),(4,'A','2026-01-06',6::DOUBLE),(5,'B','2026-01-01',NULL::DOUBLE),(6,'B','2026-01-02',CAST('Infinity' AS DOUBLE))) AS t(sequence,team,day,amount)",['sequence','team','day','amount'],{sequence:'Int32',team:'Utf8',day:'Utf8',amount:'Float64'});
  const data=await execute(page,chain(input,[{id:'rolling',op:'movingAvg',params:{field:'amount',window:3,partitions:['team']}}]));
  expect(data.result.rows.map(row=>row.sequence)).toEqual([0,1,2,3,4,5,6]);
  expect(data.result.rows.map(row=>row.amount)).toEqual([10,10,10,4,5,null,null]);
  expect(data.result.steps[0]).toMatchObject({rowsIn:7,rowsOut:7,exclusions:{amount:4}});
  expectStepCounts(data);
});

test('GA-2 Stats uses only finite numeric values, even medians average the middle pair, and empty stats split count from nulls',async({page})=>{
  await ready(page);
  const mixed=source("SELECT * FROM (VALUES (0,1::DOUBLE),(1,3::DOUBLE),(2,5::DOUBLE),(3,CAST('NaN' AS DOUBLE)),(4,NULL::DOUBLE)) AS t(sequence,amount)",['sequence','amount'],{sequence:'Int32',amount:'Float64'});
  const odd=await execute(page,chain(mixed,[{id:'stats',op:'stats',params:{field:'amount'}}]));
  expect(odd.result.rows).toHaveLength(1);
  expect(odd.result.rows[0].count).toBe(3);
  expect(odd.result.rows[0].min).toBe(1);
  expect(odd.result.rows[0].max).toBe(5);
  expect(odd.result.rows[0].mean).toBe(3);
  expect(odd.result.rows[0].median).toBe(3);
  expect(odd.result.rows[0].stddev).toBeCloseTo(Math.sqrt(8/3),5);
  expect(odd.result.steps[0]).toMatchObject({rowsIn:5,rowsOut:1,exclusions:{amount:2}});
  const evenSource=source("SELECT * FROM (VALUES (1,1::DOUBLE),(2,3::DOUBLE),(3,5::DOUBLE),(4,7::DOUBLE)) AS t(sequence,amount)",['sequence','amount'],{sequence:'Int32',amount:'Float64'});
  const even=await execute(page,chain(evenSource,[{id:'stats',op:'stats',params:{field:'amount'}}]));
  expect(even.result.rows[0].median).toBe(4);
  const emptySource=source('SELECT 1::BIGINT AS sequence, NULL::DOUBLE AS amount WHERE FALSE',['sequence','amount'],{sequence:'Int64',amount:'Float64'});
  const empty=await execute(page,chain(emptySource,[{id:'stats',op:'stats',params:{field:'amount'}}]));
  expect(empty.result.rows).toEqual([{count:0,min:null,max:null,mean:null,median:null,stddev:null}]);
  expect(empty.result.steps[0]).toMatchObject({rowsIn:0,rowsOut:1,exclusions:{amount:0}});
  for(const data of [odd,even,empty])expectStepCounts(data);
});

test('GA-2 compositions produce hand-checked values for Bucket → MovingAvg and Between → GroupBy → Top',async({page})=>{
  await ready(page);
  const daily=source("SELECT * FROM (VALUES (0,'2026-01-01',10::DOUBLE),(1,'2026-01-03',30::DOUBLE)) AS t(sequence,day,amount)",['sequence','day','amount'],{sequence:'Int32',day:'Utf8',amount:'Float64'},null);
  const smooth=await execute(page,chain(daily,[
    {id:'weekly',op:'bucket',params:{dateField:'day',grain:'day',partitions:[],aggregations:[aggregate('SUM','amount')],periodName:'day'}},
    {id:'average',op:'movingAvg',params:{field:'amount',window:2,partitions:[]}}
  ]));
  expect(smooth.result.rows).toEqual([{day:'2026-01-01',amount:10},{day:'2026-01-02',amount:5},{day:'2026-01-03',amount:15}]);
  const rows=source("SELECT * FROM (VALUES (0,'A',1::DOUBLE),(1,'A',2::DOUBLE),(2,'A',8::DOUBLE),(3,'B',3::DOUBLE),(4,'B',7::DOUBLE),(5,'B',9::DOUBLE),(6,'C',4::DOUBLE),(7,'C',6::DOUBLE)) AS t(sequence,team,amount)",['sequence','team','amount'],{sequence:'Int32',team:'Utf8',amount:'Float64'});
  const ranked=await execute(page,chain(rows,[
    {id:'range',op:'between',params:{field:'amount',mode:'numeric',lower:2,upper:8}},
    {id:'teams',op:'groupBy',params:{groups:['team'],aggregations:[aggregate('SUM','total')]}},
    {id:'top',op:'top',params:{field:'total',n:2,direction:'desc'}}
  ]));
  expect(ranked.result.rows).toEqual([{team:'A',total:10},{team:'B',total:10}]);
  expect(ranked.result.steps.map(step=>[step.rowsIn,step.rowsOut])).toEqual([[8,6],[6,3],[3,2]]);
  for(const data of [smooth,ranked])expectStepCounts(data);
});

test('GA-2 parameter references change Between results on re-run while the saved chain keeps the references',async({page})=>{
  await ready(page);
  const input=source("SELECT * FROM (VALUES (0,1::DOUBLE),(1,2::DOUBLE),(2,3::DOUBLE),(3,4::DOUBLE),(4,5::DOUBLE)) AS t(sequence,amount)",['sequence','amount'],{sequence:'Int32',amount:'Float64'});
  const chainInput=chain(input,[{id:'range',op:'between',params:{field:'amount',mode:'numeric',lower:{param:'low'},upper:{param:'high'}}}]);
  const parameters=[{name:'low',type:'number',value:1},{name:'high',type:'number',value:3}];
  const first=await execute(page,chainInput,parameters);
  const second=await execute(page,chainInput,[{name:'low',type:'number',value:4},{name:'high',type:'number',value:5}]);
  expect(first.result.rows.map(row=>row.amount)).toEqual([1,2,3]);
  expect(second.result.rows.map(row=>row.amount)).toEqual([4,5]);
  expect(first.result.sql).toBe(second.result.sql);
  expect(first.result.sql).toContain('{{low}}');expect(first.result.sql).toContain('{{high}}');
  const saved=await page.evaluate(async ({chain,sql,columns})=>{
    const queries=await import('/src/data/queries.js');
    const value=queries.saveQuery({name:'Parameterized Between',chain,sql,columns,fieldKeys:columns,mapping:{},dependencies:[]});
    return JSON.parse(queries.serializeQueries()).items[value.id];
  },{chain:first.result.chain,sql:first.result.sql,columns:first.result.columns});
  expect(saved.chain.steps[0].params).toEqual({field:'amount',mode:'numeric',lower:{param:'low'},upper:{param:'high'}});
});

test('GA-2 Transform preview shows the inverted-Between warning and exclusion provenance',async({page})=>{
  await ready(page);
  const sql="SELECT * FROM (VALUES (0,1::DOUBLE),(1,2::DOUBLE),(2,NULL::DOUBLE),(3,CAST('NaN' AS DOUBLE))) AS t(sequence,amount)";
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Between source',sql,columns:['sequence','amount'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const layout={app:'dashboard-builder',version:1,tiles:[{id:'between-warning',type:'table',title:'Between warning',dataset:`query:${sourceId}`,x:0,y:0,w:8,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'between-warning.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await page.locator('[gs-id="between-warning"] .tile-data-btn').click();
  const dataPanel=page.locator('.data-popover:not(.wrangling-popover)');await dataPanel.getByRole('button',{name:'Transform',exact:true}).click();let editor=page.locator('.wrangling-popover');
  await editor.getByLabel('New transform operation').selectOption('between');await editor.getByRole('button',{name:'Add step'}).click();
  await editor.getByLabel('Step 1 column',{exact:true}).selectOption('amount');await editor.getByRole('spinbutton',{name:'Step 1 lower bound'}).fill('9');await editor.getByRole('spinbutton',{name:'Step 1 upper bound'}).fill('2');
  await editor.getByRole('button',{name:'Preview transforms'}).click();
  await expect(editor.locator('.transform-warning')).toContainText(/lower bound exceeds upper bound/i);
  await expect(editor.locator('.transform-count')).toContainText('4 rows');await expect(editor.locator('.transform-count')).toContainText('0 rows');
  await expect(editor.locator('.transform-provenance')).toContainText('2 invalid/missing values excluded from amount');
  await expect(editor.getByRole('button',{name:'Apply derived query to tile'})).toBeEnabled();
});

test('GA-2 Between bounds use validated parameter pickers and offer no text parameter as a numeric bound',async({page})=>{
  await ready(page);
  const sql="SELECT * FROM (VALUES (0,1::DOUBLE),(1,2::DOUBLE),(2,3::DOUBLE),(3,4::DOUBLE)) AS t(sequence,amount)";
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Parameterized source',sql,columns:['sequence','amount'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const layout={app:'dashboard-builder',version:1,parameters:[{name:'low',type:'number',value:2},{name:'high',type:'number',value:3},{name:'label',type:'text',value:'unused'}],tiles:[{id:'parameter-picker',type:'table',title:'Parameter picker',dataset:`query:${sourceId}`,x:0,y:0,w:8,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'parameter-picker.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await page.locator('[gs-id="parameter-picker"] .tile-data-btn').click();
  const dataPanel=page.locator('.data-popover:not(.wrangling-popover)');await dataPanel.getByRole('button',{name:'Transform',exact:true}).click();const editor=page.locator('.wrangling-popover');
  await editor.getByLabel('New transform operation').selectOption('between');await editor.getByRole('button',{name:'Add step'}).click();
  await editor.getByLabel('Step 1 lower bound kind',{exact:true}).selectOption('parameter');
  await editor.getByLabel('Step 1 lower bound parameter',{exact:true}).selectOption('low');
  await editor.getByLabel('Step 1 upper bound kind',{exact:true}).selectOption('parameter');
  const offered=await editor.getByLabel('Step 1 upper bound parameter',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
  expect(offered).toEqual(['low','high']);
  await editor.getByLabel('Step 1 upper bound parameter',{exact:true}).selectOption('high');
  await editor.getByRole('button',{name:'Preview transforms'}).click();await expect(editor.locator('.transform-preview')).toBeVisible();
  expect(await editor.locator('.transform-preview tbody tr').evaluateAll(rows=>rows.map(row=>row.textContent))).toEqual(['23','34']);
});

test('GA-2 histogram chart draws one centered width-1 bin and labels an all-equal range degenerate',async({page})=>{
  await ready(page);
  const rendered=await page.evaluate(async()=>{
    const {histogramChart}=await import('/src/charts/charts.js');
    const chart=histogramChart([{value:7},{value:7},{value:7},{value:7}],{value:'value',bins:12});document.body.append(chart);
    return {binCount:chart.dataset.binCount,degenerate:chart.dataset.degenerate,label:chart.querySelector('.db-histogram-degenerate')?.textContent,marks:[...chart.querySelectorAll('svg rect[aria-label]')].map(rect=>rect.getAttribute('aria-label'))};
  });
  expect(rendered.binCount).toBe('1');expect(rendered.degenerate).toBe('true');
  expect(rendered.label).toMatch(/degenerate.*width 1/i);
  expect(rendered.marks).toHaveLength(1);expect(rendered.marks[0]).toMatch(/4 values from 6\.5 to 7\.5/);
});

test('GA-2 bench #1 sales: build metrics, weekly/regional revenue, and top products through Transform',async({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES
    (0,'2026-08-01','West','Widget',20::DOUBLE),(1,'2026-08-08','East','Gadget',30::DOUBLE),
    (2,'2026-08-15','West','Widget',40::DOUBLE),(3,'2026-08-22','East','Gizmo',10::DOUBLE),
    (4,'2026-08-29','West','Gadget',25::DOUBLE)
  ) AS orders(sequence,order_date,region,product,revenue)`;
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Bench 1 orders',sql,columns:['sequence','order_date','region','product','revenue'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const layout={app:'dashboard-builder',version:1,tiles:[
    ['sales-metrics','table','Sales metrics'],['sales-weekly','table','Revenue by week'],['sales-region','table','Revenue by region'],['sales-products','table','Top products']
  ].map(([id,type,title],index)=>({id,type,title,dataset:`query:${sourceId}`,x:index%2*6,y:Math.floor(index/2)*8,w:6,h:7}))};
  await page.locator('#file-import').setInputFiles({name:'bench-sales.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  async function edit(tileId,configure) {
    const tile=page.locator(`.grid-stack-item[gs-id="${tileId}"]`);
    await tile.locator('.tile-data-btn').click();
    const panel=page.locator('.data-popover:not(.wrangling-popover)');
    await panel.getByRole('button',{name:'Transform',exact:true}).click();
    const editor=page.locator('.wrangling-popover');
    await configure(editor);
    await editor.getByRole('button',{name:'Preview transforms'}).click();
    await expect(editor.locator('.transform-preview')).toBeVisible();
    await expect(editor.getByRole('button',{name:'Apply derived query to tile'})).toBeEnabled();
    await editor.getByRole('button',{name:'Apply derived query to tile'}).click();
    await expect(tile.locator('.db-data-table')).toBeVisible();
  }
  await edit('sales-metrics',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('groupBy');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);
    await editor.getByLabel('Step 1 grouping columns').selectOption([]);
    await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('revenue');
    await editor.getByLabel('Step 1 aggregation 1 operation').selectOption('SUM');await editor.getByLabel('Step 1 aggregation 1 output name').fill('revenue');
    await editor.getByRole('button',{name:'Add aggregation'}).click();
    await editor.getByLabel('Step 1 aggregation 2 source column').selectOption('revenue');await editor.getByLabel('Step 1 aggregation 2 operation').selectOption('COUNT');await editor.getByLabel('Step 1 aggregation 2 output name').fill('orders');
    await editor.getByRole('button',{name:'Add aggregation'}).click();
    await editor.getByLabel('Step 1 aggregation 3 source column').selectOption('revenue');await editor.getByLabel('Step 1 aggregation 3 operation').selectOption('AVG');await editor.getByLabel('Step 1 aggregation 3 output name').fill('average_order_value');
  });
  await edit('sales-weekly',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('bucket');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 date column').selectOption('order_date');await editor.getByLabel('Step 1 grain').selectOption('week');
    await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('revenue');await editor.getByLabel('Step 1 aggregation 1 operation').selectOption('SUM');await editor.getByLabel('Step 1 aggregation 1 output name').fill('revenue');
  });
  await edit('sales-region',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('groupBy');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);
    await editor.getByLabel('Step 1 grouping columns').selectOption(['region']);await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('revenue');await editor.getByLabel('Step 1 aggregation 1 output name').fill('revenue');
  });
  await edit('sales-products',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('groupBy');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);
    await editor.getByLabel('Step 1 grouping columns').selectOption(['product']);await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('revenue');await editor.getByLabel('Step 1 aggregation 1 output name').fill('revenue');
    await editor.getByLabel('New transform operation').selectOption('top');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 2 column',{exact:true}).selectOption('revenue');await editor.getByRole('spinbutton',{name:'Step 2 N'}).fill('2');
  });
  await expect(page.locator('[gs-id="sales-metrics"] .db-data-table')).toContainText('125');
  await expect(page.locator('[gs-id="sales-metrics"] .db-data-table')).toContainText('5');
  await expect(page.locator('[gs-id="sales-metrics"] .db-data-table')).toContainText('25');
  await expect(page.locator('[gs-id="sales-weekly"] .db-data-table')).toContainText('2026-07-27');
  await expect(page.locator('[gs-id="sales-region"] .db-data-table')).toContainText('West');
  await expect(page.locator('[gs-id="sales-products"] .db-data-table')).toContainText('Widget');
  const saved=await page.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items).filter(query=>query.chain));
  expect(saved).toHaveLength(4);
});

test('GA-2 bench #2 support: ticket counts, median resolution, weekly counts, satisfaction, and B6 Top(desc) duration',async({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES
    (0,'2026-09-01','A',1::INT,10::DOUBLE,4::DOUBLE),(1,'2026-09-03','B',1::INT,30::DOUBLE,5::DOUBLE),
    (2,'2026-09-08','A',0::INT,50::DOUBLE,3::DOUBLE),(3,'2026-09-10','C',1::INT,20::DOUBLE,4::DOUBLE),
    (4,'2026-09-15','B',1::INT,40::DOUBLE,2::DOUBLE),(5,'2026-09-18','A',1::INT,60::DOUBLE,5::DOUBLE)
  ) AS tickets(sequence,created_date,team,is_open,resolution_minutes,satisfaction)`;
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Bench 2 tickets',sql,columns:['sequence','created_date','team','is_open','resolution_minutes','satisfaction'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const layout={app:'dashboard-builder',version:1,tiles:[
    ['support-open','table','Open tickets'],['support-median','table','Median resolution'],['support-weekly','table','Tickets by week'],['support-teams','table','Slowest teams'],['support-satisfaction','table','Satisfaction']
  ].map(([id,type,title],index)=>({id,type,title,dataset:`query:${sourceId}`,x:index%2*6,y:Math.floor(index/2)*8,w:6,h:7}))};
  await page.locator('#file-import').setInputFiles({name:'bench-support.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  async function edit(tileId,configure) {
    const tile=page.locator(`.grid-stack-item[gs-id="${tileId}"]`);await tile.locator('.tile-data-btn').click();
    const panel=page.locator('.data-popover:not(.wrangling-popover)');await panel.getByRole('button',{name:'Transform',exact:true}).click();let editor=page.locator('.wrangling-popover');
    await configure(editor);await editor.getByRole('button',{name:'Preview transforms'}).click();await expect(editor.locator('.transform-preview')).toBeVisible();
    await expect(editor.getByRole('button',{name:'Apply derived query to tile'})).toBeEnabled();await editor.getByRole('button',{name:'Apply derived query to tile'}).click();await expect(tile.locator('.db-data-table')).toBeVisible();
  }
  await edit('support-open',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('between');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 column',{exact:true}).selectOption('is_open');await editor.getByRole('spinbutton',{name:'Step 1 lower bound'}).fill('1');await editor.getByRole('spinbutton',{name:'Step 1 upper bound'}).fill('1');
    await editor.getByLabel('New transform operation').selectOption('groupBy');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);await editor.getByLabel('Step 2 grouping columns').selectOption([]);
    await editor.getByLabel('Step 2 aggregation 1 source column').selectOption('is_open');await editor.getByLabel('Step 2 aggregation 1 operation').selectOption('COUNT');await editor.getByLabel('Step 2 aggregation 1 output name').fill('open_tickets');
  });
  await edit('support-median',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('stats');await editor.getByRole('button',{name:'Add step'}).click();await editor.getByLabel('Step 1 column').selectOption('resolution_minutes');
  });
  await edit('support-weekly',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('bucket');await editor.getByRole('button',{name:'Add step'}).click();await editor.getByLabel('Step 1 date column').selectOption('created_date');await editor.getByLabel('Step 1 grain').selectOption('week');
  });
  await edit('support-teams',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('groupBy');await editor.getByRole('button',{name:'Add step'}).click();await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);
    await editor.getByLabel('Step 1 grouping columns').selectOption(['team']);await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('resolution_minutes');await editor.getByLabel('Step 1 aggregation 1 operation').selectOption('AVG');await editor.getByLabel('Step 1 aggregation 1 output name').fill('duration');
    await editor.getByLabel('New transform operation').selectOption('top');await editor.getByRole('button',{name:'Add step'}).click();await editor.getByLabel('Step 2 column',{exact:true}).selectOption('duration');await editor.getByRole('spinbutton',{name:'Step 2 N'}).fill('2');await editor.getByLabel('Step 2 direction',{exact:true}).selectOption('desc');
  });
  await edit('support-satisfaction',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('stats');await editor.getByRole('button',{name:'Add step'}).click();await editor.getByLabel('Step 1 column').selectOption('satisfaction');
  });
  await expect(page.locator('[gs-id="support-open"] .db-data-table')).toContainText('5');
  await expect(page.locator('[gs-id="support-median"] .db-data-table')).toContainText('35');
  await expect(page.locator('[gs-id="support-weekly"] .db-data-table')).toContainText('2026-08-31');
  await expect(page.locator('[gs-id="support-teams"] .db-data-table')).toContainText('B');
  await expect(page.locator('[gs-id="support-teams"] .db-data-table')).toContainText('35');
  await expect(page.locator('[gs-id="support-satisfaction"] .db-data-table')).toContainText('3.8');
  const chain=await page.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items).map(query=>query.chain).find(value=>value?.steps.some(step=>step.op==='top')));
  expect(chain.steps[1]).toMatchObject({op:'top',params:{field:'duration',direction:'desc'}});
});
