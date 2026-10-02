import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const upload = { name:'Revenue',columns:['label','value'],rows:[{label:'North',value:12},{label:'South',value:30}],fieldKeys:['label','value'],mapping:{label:'label',value:'value'},raw:null };
const envelope = (tiles,datasets={},queries={}) => ({app:'dashboard-builder',version:1,theme:'paper',tiles,datasets,queries});
const tile = (dataset='categorical',opts={}) => ({id:'t1',type:'bar',dataset,title:'Revenue',x:0,y:0,w:6,h:5,...opts});
async function ready(page) { await page.goto('/'); await expect(page.locator('#status')).toContainText('build'); }
async function importJSON(page,data) {
  await page.locator('#status').evaluate(e=>e.textContent='Reading test import…');
  await page.locator('#file-import').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#status')).toContainText(/Imported|Import failed/);
}
async function jsonExport(page) {
  const downloaded=page.waitForEvent('download'); await page.locator('#btn-export').click();
  const download=await downloaded; return JSON.parse(await fs.readFile(await download.path(),'utf8'));
}
test('R1/R3/R9: totals, units, explicit binding reload and keyboard dialog focus', async ({page}) => {
  await ready(page);
  await expect(page.locator('.db-donut')).toContainText('48,240');
  const add=page.locator('.palette-item').filter({hasText:'Bar chart'});
  const before=await page.locator('.tile').count(); await add.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.tile')).toHaveCount(before+1);
  const added=page.locator('.tile').last(); await added.locator('.tile-data-btn').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.data-popover')).toBeVisible();
  await expect(page.locator('.data-pop-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>document.querySelector('.data-popover').contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(added.locator('.tile-data-btn')).toBeFocused();
  await added.locator('.tile-remove').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.tile')).toHaveCount(before);
  const data=envelope([tile('categorical',{tileOptions:{xLabel:'USD'}})],{revenue:upload});
  data.defaultDataset={kind:'dataset',ref:'upload:revenue'};
  await importJSON(page,data); await expect(page.locator('#status')).toContainText('Imported');
  await page.reload(); await expect(page.locator('.tile-data-label')).toHaveText('Categories (8)');
  await expect(page.locator('.tile-chart')).toContainText('USD');
  const exported=await jsonExport(page); expect(exported.version).toBe(3); expect(exported.tiles[0].binding).toEqual({mode:'explicit',ref:'categorical'});
  await page.locator('#btn-templates').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.tpl-close')).toBeFocused(); await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>document.querySelector('.tpl-modal').contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#btn-templates')).toBeFocused();
});
test('R2: query JSON carries uploaded inputs into empty storage; HTML works offline', async ({page,browser},testInfo) => {
  await ready(page);
  await importJSON(page,envelope([tile('query:q1',{tileOptions:{xLabel:'USD'}})],{sales:upload},{q1:{name:'Sales SQL',sql:'SELECT label, value FROM upload_sales',columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'}}}));
  await expect(page.locator('.tile-chart svg')).toBeVisible(); await expect(page.locator('.tile-chart')).toContainText('30');
  const json=await jsonExport(page); expect(json.datasets.sales.rows).toEqual(upload.rows);
  const context=await browser.newContext(); const fresh=await context.newPage(); await ready(fresh); await importJSON(fresh,json);
  await expect(fresh.locator('.tile-chart svg')).toBeVisible(); await expect(fresh.locator('.tile-chart')).toContainText('USD');
  const downloaded=fresh.waitForEvent('download'); await fresh.locator('#btn-export-html').click();
  const download=await downloaded, html=await fs.readFile(await download.path(),'utf8');
  expect(html).toContain('North'); expect(html).not.toContain('__DASHBOARD_PAYLOAD__');
  await fresh.route('**/*',route=>route.abort()); await context.setOffline(true); await fresh.setContent(html,{waitUntil:'load'});
  await expect(fresh.locator('.export-tile svg')).toBeVisible(); await expect(fresh.locator('.export-tile')).toContainText('30');
  await expect(fresh.locator('.export-tile')).toContainText('USD');
  await fresh.emulateMedia({media:'print'}); expect(await fresh.locator('.export-tile').evaluate(e=>getComputedStyle(e).breakInside)).toMatch(/avoid/);
  const pdf=await fresh.pdf({path:'docs/verification/offline-export-print.pdf',format:'A4',printBackground:true});
  expect(pdf.subarray(0,4).toString()).toBe('%PDF');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length).toBe(1);
  await testInfo.attach('browser-version',{body:browser.version(),contentType:'text/plain'});
  await context.close();
});
test('R2/R7: missing references stay blocked; collision and invalid imports preserve current layout', async ({page}) => {
  await ready(page); await importJSON(page,envelope([tile('upload:absent')]));
  await expect(page.locator('.tile-error')).toContainText('Data unavailable'); await expect(page.locator('.tile-chart svg')).toHaveCount(0);
  let json=await jsonExportWithOmissions(page); expect(json.tiles[0].dataset).toBe('upload:absent');
  await page.reload(); await expect(page.locator('.tile-error')).toContainText('Data unavailable');
  await importJSON(page,envelope([tile('upload:sales')],{sales:upload}));
  await importJSON(page,envelope([tile('upload:sales')],{sales:{...upload,rows:[{label:'Wrong',value:99}]}}));
  await expect(page.locator('#status')).toContainText('Conflicting'); await expect(page.locator('.tile-chart')).toContainText('North');
  await importJSON(page,envelope([tile('categorical',{type:'constructor'})])); await expect(page.locator('#status')).toContainText('Import failed');
  await expect(page.locator('.tile-chart')).toContainText('North');
  await importJSON(page,envelope([tile('query:missing')])); await expect(page.locator('.tile-error')).toContainText('Saved query unavailable');
  json=await jsonExportWithOmissions(page); expect(json.tiles[0].dataset).toBe('query:missing');
});
async function jsonExportWithOmissions(page) { page.once('dialog',d=>d.accept()); return jsonExport(page); }
test('R4: delayed SQL A after edit to B and mapping change never enables Apply', async ({page}) => {
  await page.route('**/src/data/duckdb.js',async route=>{
    const response=await route.fetch();
    const source=(await response.text()).replace('return coordinator.run(sql);','return new Promise(resolve => setTimeout(resolve, 300)).then(() => coordinator.run(sql));');
    await route.fulfill({response,body:source});
  });
  await ready(page); await page.locator('.tile-data-btn').first().click(); await page.getByRole('button',{name:'SQL',exact:true}).click();
  const sql=page.locator('.data-sql-input'); await expect(page.locator('.data-sql-run')).toBeEnabled();
  await sql.fill("SELECT 'A' AS label, 1 AS value"); await page.locator('.data-sql-run').click();
  await sql.fill("SELECT 'B' AS label, 2 AS value"); await expect(page.locator('.data-sql-status')).toContainText('Run again');
  await expect(page.locator('.data-apply').last()).toBeDisabled();
  await page.locator('.data-sql-run').click(); await expect(page.locator('.data-apply').last()).toBeEnabled();
  await sql.fill("SELECT 'C' AS label, 3 AS value");
  await page.locator('.data-mapping select').last().selectOption('value'); await expect(page.locator('.data-apply').last()).toBeDisabled();
  await page.locator('.data-sql-run').click(); await expect(page.locator('.data-apply').last()).toBeEnabled();
  await page.evaluate(async()=>{const {saveDataset}=await import('/src/data/store.js');saveDataset({name:'Revision',columns:['value'],rows:[{value:1}],fieldKeys:[],mapping:{}});});
  await expect(page.locator('.data-apply').last()).toBeDisabled();
  await sql.fill('SELECT invalid FROM no_such_table'); await page.locator('.data-sql-run').click();
  await expect(page.locator('.data-error').last()).toBeVisible(); await expect(page.locator('.data-apply').last()).toBeDisabled();
});
test('R5/R7: quota fault during import restores old chart and removes new dataset records', async ({page}) => {
  await ready(page); await importJSON(page,envelope([tile('categorical')]));
  await page.evaluate(()=>{
    const set=Storage.prototype.setItem; let failed=false;
    Storage.prototype.setItem=function(k,v){ if(k==='dashboard-builder:layout:v1'&&!failed){failed=true;throw new DOMException('Injected quota','QuotaExceededError');}return set.call(this,k,v); };
  });
  await importJSON(page,envelope([tile('upload:new')],{new:upload})); await expect(page.locator('#status')).toContainText('Import failed');
  await expect(page.locator('.tile-data-label')).toHaveText('Categories (8)');
  expect(await page.evaluate(async()=>{const {getDataset}=await import('/src/data/store.js');return getDataset('new');})).toBeNull();
  await page.reload(); await expect(page.locator('.tile-data-label')).toHaveText('Categories (8)');
});
test('R6/R9: capacity, query cap and supported editor viewport', async ({page},testInfo) => {
  await ready(page);
  const measurements=await page.evaluate(async()=>{
    const {TILE_TYPES}=await import('/src/tiles/registry.js');
    const rows=Array.from({length:250000},(_,i)=>({x:i,y:i,value:i,date:String(i)}));
    const results={};
    for(const type of ['scatter','line']) {const el=document.createElement('div');document.body.append(el); const start=performance.now();TILE_TYPES[type].render(el,{data:rows,options:{tileOptions:{trend:true}}});results[type]={ms:performance.now()-start,svg:!!el.querySelector('svg'),note:el.textContent.includes('250,000')};el.remove();}
    return results;
  });
  expect(measurements.scatter.svg).toBe(true); expect(measurements.line.svg).toBe(true);
  expect(measurements.scatter.note).toBe(true);
  await testInfo.attach('capacity-measurements',{body:JSON.stringify(measurements),contentType:'application/json'});
  expect(measurements.scatter.ms).toBeLessThan(1000); expect(measurements.line.ms).toBeLessThan(1000);
  await page.locator('.tile-data-btn').first().click(); await page.getByRole('button',{name:'SQL',exact:true}).click(); await expect(page.locator('.data-sql-run')).toBeEnabled();
  await page.locator('.data-sql-input').fill('SELECT * FROM range(10001)'); await page.locator('.data-sql-run').click(); await expect(page.locator('.data-error').last()).toContainText('10,000');
  await page.keyboard.press('Escape'); await page.setViewportSize({width:1024,height:768});
  expect(await page.locator('#btn-export-html').isVisible()).toBe(true);
  await page.screenshot({path:'docs/verification/composer-1024.png'});
});
test('R5: unavailable IndexedDB retains legacy records across reload with visible retry', async ({page}) => {
  await page.addInitScript(()=>{
    Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});
    if(!localStorage.getItem('klaroDash.datasets.v1')) localStorage.setItem('klaroDash.datasets.v1',JSON.stringify({legacy:{name:'Legacy',columns:['label','value'],rows:[{label:'Recover',value:42}],mapping:{},fieldKeys:[]}}));
  });
  await ready(page); await expect(page.locator('#status')).toContainText('original retained');
  expect(await page.evaluate(()=>!!localStorage.getItem('klaroDash.datasets.v1'))).toBe(true);
  await page.reload(); await expect(page.getByRole('button',{name:'Retry data migration'})).toBeVisible();
  expect(await page.evaluate(async()=>{const {getDataset}=await import('/src/data/store.js');return getDataset('legacy').persisted;})).toBe(false);
});
test('R5/R7: partial IndexedDB write and construction faults leave prior layout and data intact', async ({page}) => {
  await ready(page); await importJSON(page,envelope([tile('categorical')]));
  await page.evaluate(()=>{
    const add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(value,...rest){if(value.id==='fault')throw new DOMException('Injected write failure','QuotaExceededError');return add.call(this,value,...rest);};
  });
  await importJSON(page,envelope([tile('upload:new')],{new:upload,fault:upload})); await expect(page.locator('#status')).toContainText('Import failed');
  expect(await page.evaluate(async()=>{const {getDataset}=await import('/src/data/store.js');return getDataset('new');})).toBeNull();
  await expect(page.locator('.tile-data-label')).toHaveText('Categories (8)');
  await page.evaluate(()=>{
    const create=document.createElement.bind(document); let failed=false;
    document.createElement=function(tag,...rest){if(tag==='input'&&!failed){failed=true;throw new Error('Injected construction failure');}return create(tag,...rest);};
  });
  await importJSON(page,envelope([tile('upload:new')],{new:upload})); await expect(page.locator('#status')).toContainText('Import failed');
  await page.reload(); await expect(page.locator('.tile-data-label')).toHaveText('Categories (8)');
});
test('R4/R8: real WASM precision, immediate cache invalidation and serialized resynchronization', async ({page}) => {
  await ready(page);
  const result=await page.evaluate(async()=>{
    const sql=await import('/src/data/duckdb.js'), store=await import('/src/data/store.js'), {TILE_TYPES}=await import('/src/tiles/registry.js');
    const exact=await sql.runQuery("SELECT 9007199254740993::BIGINT AS value, 'Exact' AS label");
    const query={sql:'SELECT label,value FROM categorical',mapping:{label:'label',value:'value'}};
    await sql.runTileQuery('probe',query,TILE_TYPES.bar); const before=!!sql.getCachedRows('probe',query,TILE_TYPES.bar);
    const {id}=store.saveDataset({name:'Sync1',columns:['value'],rows:[{value:1}],fieldKeys:[],mapping:{}});
    const stale=sql.getCachedRows('probe',query,TILE_TYPES.bar);
    const sync=sql.ensureTables();
    const second=store.saveDataset({name:'Sync2',columns:['value'],rows:[{value:2}],fieldKeys:[],mapping:{}});
    await Promise.all([sync,sql.ensureTables()]);
    const latest=await sql.runQuery('SELECT value FROM upload_'+second.id);
    return {exact:exact.rows[0].value,before,stale,latest:latest.rows[0].value};
  });
  expect(result).toEqual({exact:'9007199254740993',before:true,stale:null,latest:2});
});
test('R6/R9: worker upload, keyboard save/import/export and cancel remain operable', async ({page}) => {
  await ready(page); await importJSON(page,envelope([tile('categorical')]));
  await page.locator('.tile-data-btn').focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Upload',exact:true}).focus(); await page.keyboard.press('Enter');
  await page.locator('.data-popover input[type=file]').setInputFiles({name:'revenue.csv',mimeType:'text/csv',buffer:Buffer.from('label,value\nNorth,12\nSouth,30')});
  await expect(page.locator('.data-preview-note').first()).toContainText('2 rows');
  await page.locator('.data-apply').first().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.tile-data-label')).toContainText('revenue.csv');
  await page.locator('#btn-save').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#status')).toContainText('Saved');
  const downloaded=page.waitForEvent('download'); await page.locator('#btn-export').focus(); await page.keyboard.press('Enter'); await downloaded;
  const chooser=page.waitForEvent('filechooser'); await page.locator('#btn-import').focus(); await page.keyboard.press('Enter');
  await (await chooser).setFiles({name:'keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(envelope([tile('categorical')])))});
  await expect(page.locator('#status')).toContainText('Imported');
  await page.locator('.tile-data-btn').click(); await page.getByRole('button',{name:'Upload',exact:true}).click();
  await page.route('**/src/data/parse.worker.js*',async route=>{await new Promise(r=>setTimeout(r,1000));await route.continue();});
  const csv='label,value\n'+'North,12\n'.repeat(200000);
  await page.locator('.data-popover input[type=file]').setInputFiles({name:'large.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('button',{name:'Cancel upload'}).click(); await expect(page.locator('.data-error').first()).toContainText('cancelled');
});
