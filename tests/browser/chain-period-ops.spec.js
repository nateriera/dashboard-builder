import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');await expect(page.locator('#status')).toContainText('build');
  const hint=page.locator('.first-run-hint');if(await hint.isVisible())await hint.getByRole('button',{name:'Got it'}).click();
}

const source=(sql,columns,types)=>({sql,dependencies:[],schema:{columns,types},order:{kind:'columns',fields:['sequence']}});
async function execute(page,input,steps,parameters=[],options={}) {
  return page.evaluate(async({input,steps,parameters,options})=>{
    const engine=await import('/src/data/duckdb.js');
    return engine.previewTransformChain({version:1,source:input,steps,outputMapping:{}},parameters,{sampleOnly:false,...options});
  },{input,steps,parameters,options});
}

test('GB-1 engine: Cumulative carries invalids by partition, Change counts null causes, and periodPair shifts at execution',async({page})=>{
  await ready(page);
  const cumulativeSource=source(`SELECT * FROM (VALUES
    (1,'A',10::DOUBLE),(2,'A',NULL::DOUBLE),(3,'A',5::DOUBLE),(4,'A',CAST('Infinity' AS DOUBLE)),(5,'B',2::DOUBLE)
  ) AS t(sequence,team,amount)`,['sequence','team','amount'],{sequence:'Int32',team:'Utf8',amount:'Float64'});
  const cumulative=await execute(page,cumulativeSource,[{id:'running',op:'cumulative',params:{field:'amount',partitions:['team']}}]);
  expect(cumulative.errors).toEqual([]);
  expect(cumulative.rows.map(row=>[row.sequence,row.team,Number(row.amount)])).toEqual([[1,'A',10],[2,'A',10],[3,'A',15],[4,'A',15],[5,'B',2]]);
  expect(cumulative.steps[0]).toMatchObject({rowsIn:5,rowsOut:5});
  expect(cumulative.steps[0].provenance).toContainEqual({kind:'cumulativeInvalids',name:'amount',count:2});

  const varcharSource=source(`SELECT * FROM (VALUES (1,'7'),(2,'-3')) AS t(sequence,amount)`,['sequence','amount'],{sequence:'Int32',amount:'Utf8'});
  const varcharRun=await execute(page,varcharSource,[{id:'strict',op:'cumulative',params:{field:'amount',partitions:[]}}]);
  expect(varcharRun.rows.map(row=>Number(row.amount))).toEqual([0,0]);
  expect(varcharRun.steps[0].provenance).toContainEqual({kind:'cumulativeInvalids',name:'amount',count:2});

  const changeSource=source(`SELECT * FROM (VALUES
    (1,15::DOUBLE,10::DOUBLE),(2,3::DOUBLE,0::DOUBLE),(3,1::DOUBLE,-2::DOUBLE),(4,NULL::DOUBLE,4::DOUBLE),(5,9::DOUBLE,NULL::DOUBLE)
  ) AS t(sequence,current_value,previous_value)`,['sequence','current_value','previous_value'],{sequence:'Int32',current_value:'Float64',previous_value:'Float64'});
  const changed=await execute(page,changeSource,[{id:'change',op:'change',params:{currentField:'current_value',previousField:'previous_value',outputName:'change_pct'}}]);
  expect(changed.rows.map(row=>row.change_pct==null?null:Number(row.change_pct))).toEqual([50,null,150,null,null]);
  expect(changed.steps[0].provenance).toEqual(expect.arrayContaining([
    {kind:'change:previousZero',name:'change_pct',count:1},
    {kind:'change:previousInvalid',name:'change_pct',count:1},
    {kind:'change:currentInvalid',name:'change_pct',count:1}
  ]));
  const rendered=await page.evaluate(async()=>{
    const {kpiRow}=await import('/src/charts/charts.js');const root=document.createElement('div');root.append(kpiRow([{label:'Change',value:null}]));
    return root.querySelector('.db-kpi-value')?.textContent;
  });
  expect(rendered).toBe('—');

  const periodSource=source(`SELECT * FROM (VALUES
    (1,'2026-01-10','A',5::DOUBLE),(2,'2026-01-09','A',2::DOUBLE),(3,'2026-01-08','B',4::DOUBLE),
    (4,'2026-01-07','A',10::DOUBLE),(5,'2026-01-06','C',8::DOUBLE),(6,'2026-01-04','A',100::DOUBLE)
  ) AS t(sequence,day,team,amount)`,['sequence','day','team','amount'],{sequence:'Int32',day:'Utf8',team:'Utf8',amount:'Float64'});
  const parameters=[{name:'days',type:'number',value:3}];
  const pairStep={id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:{param:'days'}},outputCurrent:'current',outputPrevious:'previous'}};
  const pair=await execute(page,periodSource,[pairStep],parameters,{now:new Date('2026-01-10T12:00:00')});
  expect(pair.errors).toEqual([]);
  expect(pair.rows.map(row=>[row.team,Number(row.current),Number(row.previous)])).toEqual([['A',7,10],['B',4,0],['C',0,8]]);
  const avg=await execute(page,periodSource,[{...pairStep,id:'avg',params:{...pairStep.params,aggregate:'AVG'}}],parameters,{now:new Date('2026-01-10T12:00:00')});
  expect(avg.rows.map(row=>[row.team,row.current==null?null:Number(row.current),row.previous==null?null:Number(row.previous)])).toEqual([['A',3.5,10],['B',4,null],['C',null,8]]);
  const shifted=await execute(page,periodSource,[pairStep],parameters,{now:new Date('2026-01-09T12:00:00')});
  expect(shifted.sql).toBe(pair.sql);expect(shifted.rows.find(row=>row.team==='A').current).toBe(12);
});

test('GB-1 Transform editor exposes all three operations and previews their configured forms',async({page})=>{
  await ready(page);
  const seeded=await page.evaluate(async()=>{
    const date=new Date(),local=()=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const yesterday=new Date(date);yesterday.setDate(yesterday.getDate()-1);
    const prior=`${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    return (await import('/src/data/queries.js')).saveQuery({name:'GB-1 editor source',sql:`SELECT * FROM (VALUES (1,'${local()}','A',10::DOUBLE,10::DOUBLE,5::DOUBLE),(2,'${prior}','A',5::DOUBLE,5::DOUBLE,2::DOUBLE),(3,'${local()}','B',3::DOUBLE,3::DOUBLE,1::DOUBLE)) AS t(sequence,day,team,amount,current_value,previous_value)`,columns:['sequence','day','team','amount','current_value','previous_value'],fieldKeys:[],mapping:{},dependencies:[]}).id;
  });
  const layout={app:'dashboard-builder',version:1,parameters:[{name:'days',type:'number',value:2}],tiles:[{id:'period-editor',type:'table',title:'Period editor',dataset:`query:${seeded}`,x:0,y:0,w:8,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'period-editor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await page.locator('[gs-id="period-editor"] .tile-data-btn').click();
  const data=page.locator('.data-popover:not(.wrangling-popover)');await data.getByRole('button',{name:'Transform',exact:true}).click();
  const editor=page.locator('.wrangling-popover');await expect(editor.getByLabel('New transform operation')).toBeVisible({timeout:90000});
  const choices=await editor.getByLabel('New transform operation').locator('option').evaluateAll(options=>options.map(option=>option.value));
  expect(choices).toContain('cumulative');expect(choices).toContain('change');expect(choices).toContain('periodPair');
  await editor.getByLabel('Source order',{exact:true}).selectOption('columns');await editor.getByLabel('Source order fields',{exact:true}).selectOption(['sequence']);
  const add=async op=>{await editor.getByLabel('New transform operation').selectOption(op);await editor.getByRole('button',{name:'Add step',exact:true}).click();};
  const preview=editor.getByRole('button',{name:'Preview transforms',exact:true});
  await add('cumulative');await editor.getByLabel('Step 1 column',{exact:true}).selectOption('amount');
  await editor.getByLabel('Step 1 partition columns',{exact:true}).selectOption(['team']);await preview.click();
  await expect(editor.locator('.transform-count')).toContainText('3 rows → 3 rows');
  await editor.getByRole('button',{name:'Remove step 1',exact:true}).click();
  await add('change');await editor.getByLabel('Step 1 current column',{exact:true}).selectOption('current_value');
  await editor.getByLabel('Step 1 previous column',{exact:true}).selectOption('previous_value');await preview.click();
  await expect(editor.locator('.transform-preview')).toContainText('100');
  await editor.getByRole('button',{name:'Remove step 1',exact:true}).click();
  await add('periodPair');await editor.getByLabel('Step 1 date column',{exact:true}).selectOption('day');
  await editor.getByLabel('Step 1 category column',{exact:true}).selectOption('team');await editor.getByLabel('Step 1 measure column',{exact:true}).selectOption('amount');
  await editor.getByLabel('Step 1 current window days kind',{exact:true}).selectOption('parameter');
  await editor.getByLabel('Step 1 current window days parameter',{exact:true}).selectOption('days');await preview.click();
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(2);
  await expect(editor.locator('.transform-preview')).toContainText('current');await expect(editor.locator('.transform-preview')).toContainText('previous');
});

test('GB-1 periodPair + Change survives save, reload, HTML export/import, and parameter re-run',async({page,browser})=>{
  test.setTimeout(180000);await ready(page);
  const seeded=await page.evaluate(async()=>{
    const date=(offset)=>{const value=new Date();value.setHours(12,0,0,0);value.setDate(value.getDate()-offset);return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;};
    const sql=`SELECT * FROM (VALUES (1,'${date(0)}','A',10::DOUBLE),(2,'${date(1)}','A',5::DOUBLE),(3,'${date(0)}','B',6::DOUBLE),(4,'${date(1)}','B',3::DOUBLE),(5,'${date(2)}','A',4::DOUBLE)) AS t(sequence,day,team,amount) WHERE sequence <= {{limit}}`;
    const chain={version:1,source:{sql,dependencies:[],schema:{columns:['sequence','day','team','amount'],types:{sequence:'Int32',day:'Utf8',team:'Utf8',amount:'Float64'}},order:{kind:'columns',fields:['sequence']}},steps:[
      {id:'pair',op:'periodPair',params:{dateField:'day',categoryField:'team',measureField:'amount',aggregate:'SUM',currentWindow:{kind:'relative',days:{param:'days'}},outputCurrent:'current',outputPrevious:'previous'}},
      {id:'change',op:'change',params:{currentField:'current',previousField:'previous',outputName:'change_pct'}}
    ],outputMapping:{}};
    const parameters=[{name:'days',type:'number',value:1},{name:'limit',type:'number',value:5}];
    const {compileTransformChain}=await import('/src/data/wranglingTransforms.js');
    const plan=compileTransformChain(chain,{parameters});
    const {saveQuery}=await import('/src/data/queries.js');
    const saved=saveQuery({name:'Period comparison',chain,sql:plan.sql,columns:plan.columns,fieldKeys:plan.columns,mapping:{},dependencies:[]});
    return {id:saved.id,chain:plan.chain,sql:plan.sql,columns:plan.columns,parameters};
  });
  const layout={app:'dashboard-builder',version:1,parameters:seeded.parameters,tiles:[{id:'period-table',type:'table',title:'Period comparison',dataset:`query:${seeded.id}`,x:0,y:0,w:12,h:8}]};
  await page.locator('#file-import').setInputFiles({name:'period-layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  const firstTile=page.locator('.grid-stack-item[gs-id="period-table"]');
  await expect(firstTile.locator('.db-data-table tbody tr')).toHaveCount(2,{timeout:90000});
  await expect(firstTile.locator('.db-data-table')).toContainText('10');
  await clickHeaderAction(page,'#btn-save');await page.reload();await expect(page.locator('#status')).toContainText('build');
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(2,{timeout:90000});
  const downloadEvent=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const html=await fs.readFile(await(await downloadEvent).path(),'utf8');
  const payload=JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  expect(payload.layout.queries[seeded.id].chain).toEqual(seeded.chain);
  expect(payload.layout.queries[seeded.id].sql).toContain('{{limit}}');expect(payload.layout.queries[seeded.id].sql).toContain('{{days}}');
  expect(payload.layout.queries[seeded.id].chain.steps[0].params).toMatchObject({measureField:'amount',currentWindow:{kind:'relative',days:{param:'days'}},previousWindow:null});

  const context=await browser.newContext();
  try {
    const imported=await context.newPage();await ready(imported);
    await imported.locator('#file-import').setInputFiles({name:'period-export.html',mimeType:'text/html',buffer:Buffer.from(html)});
    await expect(imported.locator('#status')).toContainText('Imported');
    const tile=imported.locator('.grid-stack-item[gs-id="period-table"]');
    await tile.getByRole('button',{name:'Review query',exact:true}).click();
    await expect(imported.locator('.data-sql-run')).toBeEnabled({timeout:90000});
    await imported.locator('.data-sql-run').click();await expect(imported.locator('.data-sql-status')).toHaveText('2 rows');
    await imported.locator('.data-panel:visible .data-apply').click();
    await expect(tile.locator('.db-data-table tbody tr')).toHaveCount(2);
    const before=await tile.locator('.db-data-table tbody tr').evaluateAll(rows=>rows.map(row=>row.textContent));
    await imported.locator('#btn-filters').click();const filters=imported.locator('.dashboard-filters-popover');
    await filters.getByRole('tab',{name:'Parameters'}).click();await imported.getByLabel('Value for days').fill('2');
    await imported.getByLabel('Value for days').press('Tab');await imported.getByRole('button',{name:'Close filters and parameters'}).click();
    await expect.poll(()=>tile.locator('.db-data-table tbody tr').evaluateAll(rows=>rows.map(row=>row.textContent))).not.toEqual(before);
    await expect(tile.locator('.db-data-table tbody tr').first()).toContainText('15');
    const record=await imported.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('dashbuilder.queries.v1')).items).find(query=>query.chain?.steps?.some(step=>step.op==='periodPair')));
    expect(record.chain.source.sql).toBe(seeded.chain.source.sql);
    expect(record.chain.steps).toEqual(seeded.chain.steps);expect(record.trusted).toBe(true);
  } finally {await context.close();}
});
