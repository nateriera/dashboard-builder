import { acceptExportSnapshotConfirmation, acceptImportConfirmation, configureImportContext } from './accept-import.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

const layoutKey='dashboard-builder:layout:v1', queryKey='dashbuilder.queries.v1';
const sourceSql="SELECT 0 AS ordinal, 'West' AS region, CAST({{factor}} AS DOUBLE) AS value UNION ALL SELECT 1, 'West', CAST(4 AS DOUBLE) UNION ALL SELECT 2, 'East', CAST(3 AS DOUBLE)";
const chain=()=>({
  version:1,
  source:{sql:sourceSql,dependencies:[],schema:{columns:['ordinal','region','value'],types:{ordinal:'Int32',region:'Utf8',value:'Float64'}},order:{kind:'columns',fields:['ordinal']}},
  steps:[{id:'group',op:'groupBy',params:{groups:['region'],aggregations:[{column:'value',operation:'SUM',name:'total'}]}}],
  outputMapping:{}
});

async function ready(page) {
  await page.goto('/');await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const hint=page.locator('.first-run-hint');
  if(await hint.isVisible())await hint.getByRole('button',{name:'Got it'}).click();
}

async function seed(page) {
  await ready(page);
  const id=await page.evaluate(async chain=>{
    const {saveQuery}=await import('/src/data/queries.js');
    return saveQuery({name:'Regional totals',chain,columns:['region','total'],fieldKeys:['region','total'],mapping:{},dependencies:[]}).id;
  },chain());
  const layout={app:'dashboard-builder',version:1,parameters:[{name:'factor',type:'number',value:2}],tiles:[{id:'editable-chain',type:'table',title:'Regional totals',dataset:`query:${id}`,x:0,y:0,w:12,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'chain-layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.db-data-table')).toContainText('6');
  return id;
}

async function exportHtml(page) {
  const downloading=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  return fs.readFile(await(await downloading).path(),'utf8');
}
function payloadOf(html) {
  const match=html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();return JSON.parse(match[1]);
}

test('GA-1: saved chain survives reload, HTML import, review and re-edit without freezing parameters or stale SQL', async ({page,browser})=>{
  test.setTimeout(120000);
  const id=await seed(page);
  await clickHeaderAction(page,'#btn-save');await page.reload();
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(2);
  const html=await exportHtml(page),payload=payloadOf(html);
  expect(payload.layout.queries[id].chain).toEqual(chain());
  expect(payload.layout.queries[id].sql).toContain('{{factor}}');
  expect(payload.layout.queries[id].parameterDependencies).toEqual(['factor']);

  const context=await browser.newContext(); await configureImportContext(context);
  try {
    const imported=await context.newPage();await ready(imported);
    const passiveHtml=html.replace('</body>','<script>window.importedHtmlExecuted=true</script></body>');
    await imported.locator('#file-import').setInputFiles({name:'editable-chain.html',mimeType:'text/html',buffer:Buffer.from(passiveHtml)});
    await expect(imported.locator('#status')).toContainText('Imported');
    expect(await imported.evaluate(()=>window.importedHtmlExecuted)).toBeUndefined();
    const restored=await imported.evaluate(async id=>(await import('/src/data/queries.js')).getQuery(id),id);
    expect(restored.chain).toEqual(chain());expect(restored.trusted).toBe(false);
    expect(restored.sql).toBe(payload.layout.queries[id].sql);
    await imported.locator('.tile-data-btn').click();
    await imported.getByRole('button',{name:'Transform',exact:true}).click();
    await expect(imported.locator('.transform-panel [role="alert"]')).toContainText('Run it, then Apply');
    await imported.locator('.wrangling-popover').getByRole('button',{name:'Close',exact:true}).click();
    expect((await imported.evaluate(async id=>(await import('/src/data/queries.js')).getQuery(id),id)).trusted).toBe(false);
    await clickHeaderAction(imported,'#btn-save');await imported.reload();
    await expect(imported.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
    const tile=imported.locator('.grid-stack-item[gs-id="editable-chain"]');
    await tile.getByRole('button',{name:'Review query',exact:true}).click();
    await expect(imported.locator('.data-sql-run')).toBeEnabled({timeout:90000});
    await imported.locator('.data-sql-run').click();
    await expect(imported.locator('.data-sql-status')).toHaveText('2 rows');
    await imported.locator('.data-panel:visible .data-apply').click();
    await expect(tile.locator('.db-data-table')).toContainText('6');
    await tile.locator('.tile-data-btn').click();
    await imported.getByRole('button',{name:'Transform',exact:true}).click();
    const pop=imported.locator('.wrangling-popover');
    await expect(pop.getByLabel('Step 1 aggregation 1 operation',{exact:true})).toHaveValue('SUM');
    await pop.getByLabel('Step 1 aggregation 1 operation',{exact:true}).selectOption('AVG');
    await pop.getByRole('button',{name:'Preview transforms',exact:true}).click();
    await expect(pop.getByRole('button',{name:'Apply derived query to tile',exact:true})).toBeEnabled();
    await pop.getByRole('button',{name:'Apply derived query to tile',exact:true}).click();
    await expect(tile.locator('.db-data-table tbody tr')).toHaveCount(2);
    const latest=await imported.evaluate(async()=>{
      const {compileTransformChain}=await import('/src/data/wranglingTransforms.js');
      const records=Object.values(JSON.parse(localStorage.getItem('dashbuilder.queries.v1')).items);
      const record=records.find(record=>record.trusted&&record.chain);
      return {record,recompiled:compileTransformChain(record.chain).sql,recordCount:records.length};
    });
    expect(latest.recordCount).toBe(1);
    expect(latest.record.chain.steps[0].params.aggregations[0].operation).toBe('AVG');
    expect(latest.record.chain.source.sql).toBe(sourceSql);
    expect(latest.record.parameterDependencies).toEqual(['factor']);
    expect(latest.record.sql).toBe(latest.recompiled);expect(latest.record.sql).not.toBe(payload.layout.queries[id].sql);
    expect(latest.record.sql).toContain('{{factor}}');
    await expect(tile.locator('.db-data-table tbody tr td:last-child')).toHaveText(['3','3']);
  } finally {await context.close();}
});

test('GA-1: invalid chain metadata in an HTML import preserves layout, queries and datasets before mutation', async ({page})=>{
  test.setTimeout(120000);
  const id=await seed(page),html=await exportHtml(page),payload=payloadOf(html);
  expect(payload.layout.queries[id].chain).toEqual(chain());
  const before=await page.evaluate(async({layoutKey,queryKey})=>({layout:localStorage.getItem(layoutKey),queries:localStorage.getItem(queryKey),snapshot:(await import('/src/data/queries.js')).querySnapshot(),datasets:(await import('/src/data/store.js')).listDatasets()}),{layoutKey,queryKey});
  payload.layout.queries[id].chain.version=999;
  payload.layout.datasets={injected:{name:'Must not persist',columns:['label'],rows:[{label:'New data'}],fieldKeys:[],mapping:{},raw:null}};
  const badHtml=html.replace(/(<script id="dashboard-data" type="application\/json">)[\s\S]*?(<\/script>)/,(_,open,close)=>open+JSON.stringify(payload).replace(/</g,'\\u003c')+close);
  await page.locator('#file-import').setInputFiles({name:'bad-chain.html',mimeType:'text/html',buffer:Buffer.from(badHtml)});
  await expect(page.locator('#status')).toContainText('Import failed:');
  await expect(page.locator('#status')).toContainText(/chain|transform|version/i);
  const after=await page.evaluate(async({layoutKey,queryKey})=>({layout:localStorage.getItem(layoutKey),queries:localStorage.getItem(queryKey),snapshot:(await import('/src/data/queries.js')).querySnapshot(),datasets:(await import('/src/data/store.js')).listDatasets()}),{layoutKey,queryKey});
  expect(after).toEqual(before);
  await expect(page.locator('.grid-stack-item[gs-id="editable-chain"] .db-data-table tbody tr')).toHaveCount(2);
});

test('GA-1: handwritten SQL survives reload, HTML export/import and review without acquiring a chain', async ({page,browser})=>{
  await ready(page);
  const sql="SELECT 'Manual' AS label, 7::DOUBLE AS value";
  const id=await page.evaluate(async sql=>(await import('/src/data/queries.js')).saveQuery({sql,columns:['label','value'],mapping:{},dependencies:[]}).id,sql);
  await page.locator('#file-import').setInputFiles({name:'sql-only.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'dashboard-builder',version:1,tiles:[{id:'manual',type:'table',dataset:`query:${id}`,x:0,y:0,w:6,h:7}]}))});
  await expect(page.locator('#status')).toContainText('Imported');
  await clickHeaderAction(page,'#btn-save');await page.reload();
  await expect(page.locator('.db-data-table')).toContainText('Manual');
  const html=await exportHtml(page),record=payloadOf(html).layout.queries[id];
  expect(record.sql).toBe(sql);expect(record).not.toHaveProperty('chain');
  const context=await browser.newContext(); await configureImportContext(context);
  try {
    const imported=await context.newPage();await ready(imported);
    await imported.locator('#file-import').setInputFiles({name:'sql-only.html',mimeType:'text/html',buffer:Buffer.from(html)});
    await expect(imported.locator('#status')).toContainText('Imported');
    await imported.getByRole('button',{name:'Review query',exact:true}).click();
    await expect(imported.locator('.data-sql-input')).toHaveValue(sql);
    await expect(imported.locator('.data-sql-input')).toBeEditable();
    await expect(imported.locator('.data-sql-run')).toBeEnabled({timeout:90000});
    await imported.locator('.data-sql-run').click();
    await expect(imported.locator('.data-sql-status')).toHaveText('1 row');
    await imported.locator('.data-panel:visible .data-apply').click();
    await expect(imported.locator('.db-data-table')).toContainText('Manual');
    const records=await imported.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items));
    expect(records).toHaveLength(1);expect(records[0].sql).toBe(sql);expect(records[0]).not.toHaveProperty('chain');
  } finally {await context.close();}
});

test('GA-1: a malformed stored chain reports a blocked load and retains its durable recovery data', async ({page})=>{
  await seed(page);await clickHeaderAction(page,'#btn-save');
  const corrupt=await page.evaluate(key=>{
    const saved=JSON.parse(localStorage.getItem(key));Object.values(saved.items)[0].chain.version=999;
    const text=JSON.stringify(saved);localStorage.setItem(key,text);return text;
  },queryKey);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Saved queries could not be loaded');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  expect(await page.evaluate(key=>localStorage.getItem(key),queryKey)).toBe(corrupt);
  await expect(page.locator('.grid-stack-item[gs-id="editable-chain"]')).toHaveCount(1);
});

acceptImportConfirmation(test);
acceptExportSnapshotConfirmation(test);
