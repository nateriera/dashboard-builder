import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { acceptExportSnapshotConfirmation, acceptImportConfirmation } from './accept-import.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

const source=(sql,columns,types,order={kind:'columns',fields:['sequence']})=>({sql,dependencies:[],schema:{columns,types},order});
const chain=(input,steps,outputMapping={})=>({version:1,source:input,steps,outputMapping});
async function execute(page,transform,parameters=[]) {
  return page.evaluate(async ({transform,parameters})=>(await import('/src/data/duckdb.js')).previewTransformChain(transform,parameters,{sampleOnly:false}),{transform,parameters});
}

test('GB-2 Pivot uses live first-seen categories, keeps collision data distinct, and records original values in output metadata',async({page})=>{
  await ready(page);
  const input=source(`SELECT * FROM (VALUES
    (0,'North','North / West',10::DOUBLE),(1,'North','North - West',20::DOUBLE),
    (2,'North','North / West',5::DOUBLE),(3,'South','North / West',7::DOUBLE)
  ) AS t(sequence,region,category,units)`,['sequence','region','category','units'],{sequence:'Int32',region:'Utf8',category:'Utf8',units:'Double'});
  const result=await execute(page,chain(input,[{id:'pivot',op:'pivot',params:{rowFields:['region'],columnField:'category',measureField:'units',aggregate:'SUM'}}]));
  expect(result.errors).toEqual([]);
  expect(result.columns).toEqual(['region','pivot_north_west','pivot_north_west__2']);
  expect(result.rows).toEqual([
    {region:'North',pivot_north_west:15,pivot_north_west__2:20},
    {region:'South',pivot_north_west:7,pivot_north_west__2:0}
  ]);
  expect(result.steps[0].outputMetadata.categories.map(item=>[item.value,item.column])).toEqual([
    ['North / West','pivot_north_west'],['North - West','pivot_north_west__2']
  ]);
  const avg=await execute(page,chain(input,[{id:'pivot',op:'pivot',params:{rowFields:['region'],columnField:'category',measureField:'units',aggregate:'AVG'}}]));
  expect(avg.rows.find(row=>row.region==='South').pivot_north_west__2).toBeNull();
});

test('GB-2 Pivot refuses a 25th category before output execution and shows the reason on the Transform step',async({page})=>{
  await ready(page);
  const values=Array.from({length:25},(_,index)=>`(${index},'region','category-${index}',${index+1}::DOUBLE)`).join(',');
  const sql=`SELECT * FROM (VALUES ${values}) AS t(sequence,region,category,units)`;
  const input=source(sql,['sequence','region','category','units'],{sequence:'Int32',region:'Utf8',category:'Utf8',units:'Double'});
  const result=await execute(page,chain(input,[{id:'pivot',op:'pivot',params:{rowFields:['region'],columnField:'category',measureField:'units',aggregate:'SUM'}}]));
  expect(result.steps[0].disabled).toBe(true);
  expect(result.steps[0].reason).toMatch(/at least 25.*limit is 24/i);
  expect(result.steps[0].rowsOut).toBeNull();

  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Pivot limit source',sql,columns:['sequence','region','category','units'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const layout={app:'dashboard-builder',version:1,tiles:[{id:'pivot-limit',type:'table',title:'Pivot limit',dataset:`query:${sourceId}`,x:0,y:0,w:8,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'pivot-limit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  await page.locator('.tile-data-btn').click();
  await page.locator('.data-popover:not(.wrangling-popover)').getByRole('button',{name:'Transform',exact:true}).click();
  const editor=page.locator('.wrangling-popover');
  await editor.getByLabel('Source order',{exact:true}).selectOption('columns');
  await editor.getByLabel('Source order fields',{exact:true}).selectOption(['sequence']);
  await editor.getByLabel('New transform operation').selectOption('pivot');
  await editor.getByRole('button',{name:'Add step'}).click();
  await editor.getByLabel('Step 1 row key fields').selectOption(['region']);
  await editor.getByLabel('Step 1 column key field').selectOption('category');
  await editor.getByLabel('Step 1 measure field').selectOption('units');
  await editor.getByLabel('Step 1 aggregate').selectOption('SUM');
  await editor.getByRole('button',{name:'Preview transforms'}).click();
  await expect(editor.locator('.transform-step [role="alert"]')).toContainText(/at least 25.*limit is 24/i);
});

test('GB-2 Pivot re-enumerates columns after a parameter changes without editing the chain',async({page})=>{
  await ready(page);
  const input=source(`SELECT * FROM (VALUES
    (0,'North','alpha',10::DOUBLE),(1,'North','beta',20::DOUBLE)
  ) AS t(sequence,region,category,units) WHERE category={{keep}}`,['sequence','region','category','units'],{sequence:'Int32',region:'Utf8',category:'Utf8',units:'Double'});
  const transform=chain(input,[{id:'pivot',op:'pivot',params:{rowFields:['region'],columnField:'category',measureField:'units',aggregate:'SUM'}}]);
  const alpha=await execute(page,transform,[{name:'keep',type:'text',value:'alpha'}]);
  const beta=await execute(page,transform,[{name:'keep',type:'text',value:'beta'}]);
  expect(alpha.columns).toEqual(['region','pivot_alpha']);
  expect(beta.columns).toEqual(['region','pivot_beta']);
  expect(transform.steps[0].params).toEqual({rowFields:['region'],columnField:'category',measureField:'units',aggregate:'SUM'});
});

test('GB-2 Histogram edge assignment, maximum inclusion, zero bins, degenerate range, and pre-binned rendering match the transform rows',async({page})=>{
  await ready(page);
  const input=source(`SELECT * FROM (VALUES (0,0::DOUBLE),(1,1::DOUBLE),(2,2::DOUBLE),(3,5::DOUBLE),(4,NULL::DOUBLE)) AS t(sequence,amount)`,['sequence','amount'],{sequence:'Int32',amount:'Double'});
  const transform=chain(input,[{id:'histogram',op:'histogram',params:{field:'amount',bins:5,min:0,max:5}}]);
  const result=await execute(page,transform);
  expect(result.errors).toEqual([]);
  expect(result.columns).toEqual(['key','value','start','end']);
  expect(result.rows.map(row=>row.value)).toEqual([1,1,1,0,1]);
  expect(result.rows[2].start).toBe(2);
  expect(result.rows.at(-1).end).toBe(5);
  expect(result.steps[0].provenance.find(item=>item.kind==='invalidValues').count).toBe(1);

  const rendered=await page.evaluate(async rows=>{
    const {TILE_TYPES}=await import('/src/tiles/registry.js');
    const el=document.createElement('div');document.body.append(el);
    TILE_TYPES.histogram.render(el,{data:rows,options:{title:'Pre-binned',source:'transform',preBinnedHistogram:true,tileOptions:{binCount:20}}});
    const chart=el.querySelector('.db-histogram');
    const output={preBinned:chart.dataset.preBinned,binCount:chart.dataset.binCount,counts:JSON.parse(chart.dataset.counts)};
    el.remove();return output;
  },result.rows);
  expect(rendered).toEqual({preBinned:'true',binCount:'5',counts:[1,1,1,0,1]});

  const equal=await execute(page,chain(source(`SELECT * FROM (VALUES (0,7::DOUBLE),(1,7::DOUBLE),(2,7::DOUBLE)) AS t(sequence,amount)`,['sequence','amount'],{sequence:'Int32',amount:'Double'}),[{id:'histogram',op:'histogram',params:{field:'amount',bins:20,min:null,max:null}}]));
  expect(equal.rows).toHaveLength(1);
  expect(equal.rows[0]).toMatchObject({value:3,start:6.5,end:7.5});
});

test('GB-2 Ratio returns null for zero/missing denominators, preserves rows, and supports partitioned aggregate operands',async({page})=>{
  await ready(page);
  const input=source(`SELECT * FROM (VALUES
    (0,'A',2::DOUBLE,10::DOUBLE),(1,'A',1::DOUBLE,0::DOUBLE),
    (2,'B',2::DOUBLE,NULL::DOUBLE),(3,'B',1::DOUBLE,2::DOUBLE)
  ) AS t(sequence,region,signups,visits)` ,['sequence','region','signups','visits'],{sequence:'Int32',region:'Utf8',signups:'Double',visits:'Double'});
  const rowwise=await execute(page,chain(input,[{id:'ratio',op:'ratio',params:{numerator:{kind:'field',field:'signups'},denominator:{kind:'field',field:'visits'},partitions:[],percent:true,outputName:'conversion'}}]));
  expect(rowwise.rows).toHaveLength(4);
  expect(rowwise.rows.map(row=>row.conversion)).toEqual([20,null,null,50]);
  expect(rowwise.steps[0].provenance.find(item=>item.kind==='ratio:denominatorZero').count).toBe(1);
  expect(rowwise.steps[0].provenance.find(item=>item.kind==='ratio:denominatorInvalid').count).toBe(1);

  const aggregate=await execute(page,chain(input,[{id:'ratio',op:'ratio',params:{numerator:{kind:'aggregate',column:'signups',operation:'SUM'},denominator:{kind:'aggregate',column:'visits',operation:'SUM'},partitions:['region'],percent:true,outputName:'conversion'}}]));
  expect(aggregate.rows.map(row=>row.conversion)).toEqual([30,30,150,150]);
});

test('GB-2 Gate B bench #8 builds Bucket(day), MovingAvg(7), Pivot, and Top(5) through Transform',async({page})=>{
  await ready(page);
  const sql=`SELECT * FROM (VALUES
    (0,'2026-10-01','West','A',10::DOUBLE),(1,'2026-10-01','East','B',20::DOUBLE),
    (2,'2026-10-02','West','A',12::DOUBLE),(3,'2026-10-03','East','B',30::DOUBLE),
    (4,'2026-10-04','West','B',15::DOUBLE),(5,'2026-10-05','East','A',25::DOUBLE),
    (6,'2026-10-06','West','A',18::DOUBLE)
  ) AS orders(sequence,order_date,region,category,units)`;
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Bench 8 operations',sql,columns:['sequence','order_date','region','category','units'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const tiles=[['ops-trend','table'],['ops-pivot','table'],['ops-topdays','table']].map(([id,type],index)=>({id,type,title:id,dataset:`query:${sourceId}`,x:index*4,y:0,w:4,h:8}));
  await page.locator('#file-import').setInputFiles({name:'bench-8.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'dashboard-builder',version:1,tiles}))});
  await expect(page.locator('#status')).toContainText('Imported');
  async function edit(tileId,configure) {
    const tile=page.locator(`.grid-stack-item[gs-id="${tileId}"]`);
    await tile.locator('.tile-data-btn').click();
    const data=page.locator('.data-popover:not(.wrangling-popover)');
    await data.getByRole('button',{name:'Transform',exact:true}).click();
    const editor=page.locator('.wrangling-popover');
    await configure(editor);
    await editor.getByRole('button',{name:'Preview transforms'}).click();
    await expect(editor.locator('.transform-preview')).toBeVisible();
    await expect(editor.getByRole('button',{name:'Apply derived query to tile'})).toBeEnabled();
    await editor.getByRole('button',{name:'Apply derived query to tile'}).click();
    await expect(tile.locator('.db-data-table')).toBeVisible();
    return tile;
  }
  const trend=await edit('ops-trend',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('bucket');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 date column').selectOption('order_date');await editor.getByLabel('Step 1 grain').selectOption('day');
    await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('units');await editor.getByLabel('Step 1 aggregation 1 operation').selectOption('SUM');await editor.getByLabel('Step 1 aggregation 1 output name').fill('units');
    await editor.getByLabel('New transform operation').selectOption('movingAvg');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 2 column').selectOption('units');await editor.getByLabel('Step 2 window',{exact:true}).fill('7');
  });
  expect(await trend.locator('.db-data-table').innerText()).toContain('2026-10-01');

  const pivot=await edit('ops-pivot',async editor=>{
    await editor.getByLabel('Source order').selectOption('columns');await editor.getByLabel('Source order fields').selectOption(['sequence']);
    await editor.getByLabel('New transform operation').selectOption('pivot');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 row key fields').selectOption(['region']);await editor.getByLabel('Step 1 column key field').selectOption('category');
    await editor.getByLabel('Step 1 measure field').selectOption('units');await editor.getByLabel('Step 1 aggregate').selectOption('SUM');
  });
  await expect(pivot.locator('.db-data-table')).toContainText('pivot_a');
  await expect(pivot.locator('.db-data-table')).toContainText('pivot_b');

  const top=await edit('ops-topdays',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('bucket');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 date column').selectOption('order_date');await editor.getByLabel('Step 1 grain').selectOption('day');
    await editor.getByLabel('Step 1 aggregation 1 source column').selectOption('units');await editor.getByLabel('Step 1 aggregation 1 operation').selectOption('SUM');await editor.getByLabel('Step 1 aggregation 1 output name').fill('units');
    await editor.getByLabel('New transform operation').selectOption('top');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 2 column').selectOption('units');await editor.getByLabel('Step 2 N',{exact:true}).fill('5');
  });
  await expect(top.locator('.tile-loading')).toHaveCount(0);
  await expect(top.locator('.db-data-table tbody tr')).toHaveCount(5);
});

test('GB-2 Gate B bench #5 builds parameter-filtered Histogram and Stats tiles through Transform',async({page})=>{
  await ready(page);
  const sql=`SELECT sequence,channel,order_size FROM (VALUES
    (0,'web',10::DOUBLE),(1,'store',30::DOUBLE),(2,'web',20::DOUBLE),(3,'web',40::DOUBLE),(4,'store',50::DOUBLE)
  ) AS orders(sequence,channel,order_size) WHERE channel={{channel}}`;
  const sourceId=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({name:'Bench 5 orders',sql,columns:['sequence','channel','order_size'],fieldKeys:[],mapping:{},dependencies:[]}).id,sql);
  const tiles=[['orders-histogram','histogram'],['orders-stats','table']].map(([id,type],index)=>({id,type,title:id,dataset:`query:${sourceId}`,x:index*6,y:0,w:6,h:8}));
  await page.locator('#file-import').setInputFiles({name:'bench-5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'dashboard-builder',version:1,parameters:[{name:'channel',type:'text',value:'web'}],tiles}))});
  await expect(page.locator('#status')).toContainText('Imported');
  async function edit(tileId,configure) {
    const tile=page.locator(`.grid-stack-item[gs-id="${tileId}"]`);
    await tile.locator('.tile-data-btn').click();
    const data=page.locator('.data-popover:not(.wrangling-popover)');await data.getByRole('button',{name:'Transform',exact:true}).click();
    const editor=page.locator('.wrangling-popover');await configure(editor);
    await editor.getByRole('button',{name:'Preview transforms'}).click();await expect(editor.locator('.transform-preview')).toBeVisible();
    await expect(editor.getByRole('button',{name:'Apply derived query to tile'})).toBeEnabled();await editor.getByRole('button',{name:'Apply derived query to tile'}).click();
    return tile;
  }
  const histogram=await edit('orders-histogram',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('histogram');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 column').selectOption('order_size');await editor.getByLabel('Step 1 bins').fill('4');
    await editor.getByLabel('Output Numeric value').selectOption('value');
  });
  await expect(histogram.locator('.db-histogram[data-pre-binned="true"]')).toBeVisible();
  await expect(histogram.locator('.db-histogram')).toHaveAttribute('data-bin-count','4');
  await expect(histogram.locator('.db-histogram')).toHaveAttribute('data-counts','[1,1,0,1]');
  const stats=await edit('orders-stats',async editor=>{
    await editor.getByLabel('New transform operation').selectOption('stats');await editor.getByRole('button',{name:'Add step'}).click();
    await editor.getByLabel('Step 1 column').selectOption('order_size');
  });
  await expect(stats.locator('.db-data-table')).toContainText('3');
  await expect(stats.locator('.db-data-table')).toContainText('10');
  const saved=await page.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items).filter(query=>query.chain));
  expect(saved.filter(query=>query.chain.steps.at(-1).op==='histogram')).toHaveLength(1);
  expect(saved.filter(query=>query.chain.steps.at(-1).op==='stats')).toHaveLength(1);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export HTML'}).click()]);
  const html=await readFile(await download.path(),'utf8');
  expect(html).toContain('"preBinnedHistogram":true');
});

acceptImportConfirmation(test);
acceptExportSnapshotConfirmation(test);
