import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

test('S1: real SQL registration and query results distinguish empty text, missing values, and whitespace', async ({ page }) => {
  await ready(page);
  const rows = await page.evaluate(async () => {
    const { saveDataset } = await import('/src/data/store.js');
    const { uploadTableName } = await import('/src/data/sql.js');
    const { runQuery } = await import('/src/data/duckdb.js');
    const { id } = saveDataset({name:'Text values',columns:['position','text'],rows:[{position:0,text:''},{position:1,text:null},{position:2,text:' '},{position:3,text:NaN}],fieldKeys:[],mapping:{}});
    return (await runQuery(`SELECT text FROM "${uploadTableName(id)}" ORDER BY position`)).rows;
  });
  expect(rows).toEqual([{text:''},{text:null},{text:' '},{text:null}]);
});

test('S2: layout load and reload report blanked whitespace and preserve null versus empty categories', async ({ page }) => {
  await ready(page);
  const rows = [{label:null,value:'2'},{label:'',value:'3'},{label:'Present',value:' '}];
  const layout = {app:'dashboard-builder',version:1,defaultDataset:{kind:'dataset',ref:'upload:quality'},tiles:[{id:'quality',type:'bar',dataset:null,x:0,y:0,w:6,h:5}],datasets:{quality:{name:'Quality',columns:['label','value'],rows,fieldKeys:[],mapping:{},raw:{columns:['label','value'],rows}}}};
  await page.locator('#file-import').setInputFiles({name:'quality.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  await expect(page.locator('#status')).toContainText('1 non-numeric value blanked');
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored autosaved layout');
  await expect(page.locator('#status')).toContainText('1 non-numeric value blanked');
  const values = await page.locator('.tile-chart svg a').evaluateAll(marks => marks.map(mark => {
    const href = mark.getAttributeNS('http://www.w3.org/1999/xlink','href') || mark.getAttribute('href') || '';
    return href.startsWith('#db-crossfilter:') ? JSON.parse(decodeURIComponent(href.slice('#db-crossfilter:'.length))) : [];
  }));
  expect(values).toContainEqual([null]);
  expect(values).toContainEqual(['']);
});

test('S2: query normalization reports dropped values on initial execution and cached render', async ({ page }) => {
  await ready(page);
  const id = await page.evaluate(async () => (await import('/src/data/queries.js')).saveQuery({
    name:'Whitespace query', sql:"SELECT 'Good' AS label, '4' AS value UNION ALL SELECT 'Missing', ' '",
    columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'}
  }).id);
  const layout = {app:'dashboard-builder',version:1,tiles:[{id:'quality-query',type:'bar',dataset:`query:${id}`,x:0,y:0,w:6,h:5}]};
  await page.locator('#file-import').setInputFiles({name:'query-quality.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('1 non-numeric value blanked');
  await expect(page.locator('.tile-chart svg')).toBeVisible();
  const cached = await page.evaluate(async id => {
    const { getCachedRows, runTileQuery } = await import('/src/data/duckdb.js');
    const { getQuery } = await import('/src/data/queries.js');
    const { TILE_TYPES } = await import('/src/tiles/registry.js');
    const { droppedCount } = await import('/src/data/dataQuality.js');
    const query = getQuery(id), entry = TILE_TYPES.bar;
    const rows = getCachedRows(id,query,entry);
    return {cached:!!rows,dropped:droppedCount(rows || await runTileQuery(id,query,entry)),values:rows?.map(row=>row.value)};
  }, id);
  expect(cached).toEqual({cached:true,dropped:1,values:[4,null]});
});

for (const format of ['html','json']) {
  test(`S2: ${format} export blanks and reports non-finite values without mutating live data`, async ({ page }) => {
    await ready(page);
    const id = await page.evaluate(async () => {
      const {saveDataset} = await import('/src/data/store.js');
      return saveDataset({name:'Nonfinite',columns:['label','amount','invalid'],rows:[{label:'Nonfinite',amount:Infinity,invalid:NaN}],fieldKeys:[],mapping:{}}).id;
    });
    const layout = {app:'dashboard-builder',version:1,tiles:[{id:'nonfinite',type:'table',dataset:`upload:${id}`,x:0,y:0,w:8,h:10}]};
    await page.locator('#file-import').setInputFiles({name:'nonfinite.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
    await expect(page.locator('#status')).toContainText('Imported');
    const downloading = page.waitForEvent('download');
    await clickHeaderAction(page, format === 'html' ? '#btn-export-html' : '#btn-export');
    const text = await fs.readFile(await (await downloading).path(), 'utf8');
    const data = format === 'json' ? JSON.parse(text) : JSON.parse(text.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const rows = format === 'json' ? data.datasets[id].rows : data.tiles[0].rows;
    expect(rows).toEqual([{label:'Nonfinite',amount:null,invalid:null}]);
    await expect(page.locator('#status')).toContainText('2 non-finite values blanked');
    const intact = await page.evaluate(async id => {
      const row = (await import('/src/data/store.js')).getDataset(id).rows[0];
      return row.amount === Infinity && Number.isNaN(row.invalid);
    }, id);
    expect(intact).toBe(true);
  });
}
