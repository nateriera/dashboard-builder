import { acceptImportConfirmation, configureImportContext } from './accept-import.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible()) await hint.getByRole('button',{name:'Got it'}).click();
}
async function importLayout(page, layout) {
  await page.locator('#file-import').setInputFiles({name:'silent-data-b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
}
const tile = (id,type,ref,x=0) => ({id,type,title:id,dataset:ref,x,y:0,w:6,h:6});
async function records(chart) {
  const details = chart.locator('.chart-data:not(.chart-drillthrough)');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await expect(details.locator('tbody tr')).not.toHaveCount(0);
  return details.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent)));
}

test('S6: donut Other selects its folded original records in the composer and offline viewer', async ({page,browser}) => {
  await ready(page);
  const rows = 'ABCDEFGHI'.split('').map((label,index)=>({label,value:9-index}));
  const raw = {columns:['label','region','value','record'],rows:rows.map(row=>({label:`Original ${row.label}`,region:row.label,value:String(row.value),record:`ID-${row.label}`}))};
  const layout = {app:'dashboard-builder',version:1,tiles:[tile('donut','donut','upload:folded'),tile('target','bar','upload:folded',6)],datasets:{folded:{name:'Folded',columns:raw.columns,fieldKeys:['label','value'],mapping:{label:'region',value:'value'},rows,raw}}};
  await importLayout(page,layout);
  const downloading = page.waitForEvent('download'); await page.locator('#btn-export-html').click();
  const html = await fs.readFile(await (await downloading).path(),'utf8');
  const context = await browser.newContext(); await configureImportContext(context);
  try {
    await context.setOffline(true); const offline = await context.newPage();
    await offline.setContent(html,{waitUntil:'load'});
    for (const surface of [page,offline]) {
      const charts = surface.locator(surface===page?'.grid-stack-item':'.export-tile');
      const donut=charts.first(),target=charts.last();
      const other=donut.locator('svg a[aria-label*="Other"]');
      const values = await other.evaluate(mark=>JSON.parse(decodeURIComponent(mark.getAttribute('href').slice('#db-crossfilter:'.length))));
      expect(values).toEqual(['F','G','H','I']);
      await other.click();
      expect(await records(target)).toEqual(raw.rows.slice(5).map(row=>Object.values(row)));
      const selected=donut.locator('.chart-drillthrough');
      await expect(selected).toHaveCount(1);
      if (surface===page) await donut.getByRole('button',{name:'Inspect 4 selected records',exact:true}).click();
      await expect(selected.locator('tbody tr')).toHaveCount(4);
      expect(await selected.locator('tbody tr td:first-child').allTextContents()).toEqual(raw.rows.slice(5).map(row=>row.label));
    }
  } finally { await context.close(); }
  const many=Array.from({length:211},(_,index)=>({label:`Category ${String(index).padStart(3,'0')}`,value:211-index}));
  await importLayout(page,{app:'dashboard-builder',version:1,tiles:[tile('many-donut','donut','upload:many'),tile('many-target','table','upload:many',6)],datasets:{many:{name:'Many categories',columns:['label','value'],rows:many,fieldKeys:['label','value'],mapping:{label:'label',value:'value'}}}});
  await page.locator('.grid-stack-item[gs-id="many-donut"] svg a[aria-label*="Other"]').focus();
  await page.keyboard.press('Enter');
  const selected=page.locator('.grid-stack-item[gs-id="many-target"] tbody tr');
  await expect(selected).toHaveCount(206);
  expect(await selected.locator('td:first-child').allTextContents()).toEqual(many.slice(5).map(row=>row.label));
  await clickHeaderAction(page,'#btn-save');await page.reload();
  await expect(page.locator('#status')).toContainText('Restored autosaved layout');
  await expect(selected).toHaveCount(206);
});

test('S7: category multiselect survives deselection, Apply, reopening and editing', async ({page}) => {
  await ready(page);
  const rows=['A','B','C'].map((label,index)=>({label,value:index+1}));
  await importLayout(page,{app:'dashboard-builder',version:1,tiles:[tile('categories','bar','upload:categories')],datasets:{categories:{columns:['label','value'],rows,fieldKeys:['label','value'],mapping:{label:'label',value:'value'}}}});
  await page.locator('#btn-filters').click(); const pop=page.locator('.dashboard-filters-popover');
  await pop.getByRole('button',{name:'Add filter',exact:true}).click();
  await pop.getByLabel('Filter field',{exact:true}).selectOption('label');
  await pop.getByRole('checkbox',{name:'A',exact:true}).check();
  await pop.getByRole('checkbox',{name:'B',exact:true}).check();
  await pop.getByRole('checkbox',{name:'A',exact:true}).uncheck();
  await pop.getByRole('button',{name:'Apply filter',exact:true}).click();
  await expect(pop.locator('.dashboard-filter-chip')).toContainText('label is B');
  await expect(pop.locator('.filters-form-error:visible')).toHaveCount(0);
  await page.locator('#btn-filters').click(); await page.locator('#btn-filters').click();
  await pop.getByRole('button',{name:'Edit label filter',exact:true}).click();
  await expect(pop.getByRole('checkbox',{name:'B',exact:true})).toBeChecked();
  await expect(pop.getByRole('checkbox',{name:'A',exact:true})).not.toBeChecked();
  await pop.getByRole('checkbox',{name:'C',exact:true}).check();
  await pop.getByRole('button',{name:'Apply filter',exact:true}).click();
  await expect(pop.locator('.dashboard-filter-chip')).toHaveCount(1);
  await page.locator('#btn-filters').click(); await clickHeaderAction(page,'#btn-save');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).filters);
  expect(saved).toEqual([{id:expect.any(String),field:'label',op:'is',values:['B','C']}]);
  await page.reload(); await expect(page.locator('#status')).toContainText('build');
  await page.locator('#btn-filters').click(); await pop.getByRole('button',{name:'Edit label filter',exact:true}).click();
  await expect(pop.getByRole('checkbox',{name:'B',exact:true})).toBeChecked();
  await expect(pop.getByRole('checkbox',{name:'C',exact:true})).toBeChecked();
  await pop.getByLabel('Filter match',{exact:true}).selectOption('is-not');
  await pop.getByRole('button',{name:'Apply filter',exact:true}).click();
  await pop.getByRole('button',{name:'Edit label filter',exact:true}).click();
  await expect(pop.getByLabel('Filter match',{exact:true})).toHaveValue('is-not');
  await expect(pop.getByRole('checkbox',{name:'B',exact:true})).toBeChecked();
  await expect(pop.getByRole('checkbox',{name:'C',exact:true})).toBeChecked();
});

test('S1-A E1/E2: HTML export discloses frozen parameters, keeps differing views disabled, and preserves every view in the editable backup', async ({page,browser}) => {
  await ready(page);
  const qid=await page.evaluate(async()=> (await import('/src/data/queries.js')).saveQuery({name:'Forecast',sql:"SELECT 'Revenue' AS label, CAST({{growth}} AS DOUBLE) * 10 AS value",columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'},dependencies:[]}).id);
  const growth=value=>({name:'growth',type:'number',value}),region={name:'region',type:'text',value:'North'};
  const views=[{id:'old',name:'Old growth 1',parameters:[growth(1),region]},{id:'matching',name:'Matching growth 2',parameters:[region,growth(2)]},{id:'missing',name:'No region',parameters:[growth(2)]}];
  await importLayout(page,{app:'dashboard-builder',version:1,tiles:[tile('forecast','bar',`query:${qid}`)],parameters:[growth(2),region],savedViews:views});
  await expect(page.locator('.tile-chart svg')).toContainText('20');
  let accept=false,downloads=0;const messages=[];
  page.on('download',()=>downloads++);
  page.on('dialog',async dialog=>{messages.push(dialog.message());if(accept)await dialog.accept();else await dialog.dismiss();});
  await page.locator('#btn-export-html').click();
  await expect(page.locator('#status')).toContainText('HTML export cancelled');
  expect(downloads).toBe(0);expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('SQL-referencing parameters are frozen');expect(messages[0]).toContain('growth: 2');
  expect(messages[0]).toContain('Old growth 1');expect(messages[0]).toContain('growth (saved 1; exported 2)');
  expect(messages[0]).toContain('No region');expect(messages[0]).toContain('region (saved not set; exported "North")');
  expect(messages[0]).not.toContain('Matching growth 2');
  const retained=await page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).savedViews.map(view=>view.name));
  expect(retained).toEqual(views.map(view=>view.name));
  accept=true;const downloading=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const html=await fs.readFile(await (await downloading).path(),'utf8');
  expect(messages).toHaveLength(2);
  const payload=JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  expect(payload.savedViews.map(view=>view.name)).toEqual(views.map(view=>view.name));
  expect(payload.savedViews.map(view=>view.disabled)).toEqual([true,false,true]);
  expect(payload.savedViews[0].disabledReason).toContain('growth (saved 1; exported 2)');
  expect(payload.savedViews[2].disabledReason).toContain('region (saved not set; exported "North")');
  expect(payload.frozenParameters).toEqual([{name:'growth',value:2}]);
  const viewValues=list=>list.map(({name,parameters})=>({name,parameters}));
  expect(viewValues(payload.layout.savedViews)).toEqual(viewValues(views));
  expect(payload.exportedAt).toBeTruthy();
  expect(viewValues(await page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).savedViews))).toEqual(viewValues(views));
  expect(payload.tiles[0].rows).toEqual([{label:'Revenue',value:20}]);
  const context=await browser.newContext(); await configureImportContext(context);
  try {
    await context.setOffline(true);const offline=await context.newPage();await offline.setContent(html,{waitUntil:'load'});
    await expect(offline.locator('.export-freeze-notice')).toContainText('Data snapshot as of');
    await expect(offline.locator('.export-freeze-notice')).toContainText('SQL-referencing parameters are frozen');
    await expect(offline.locator('.export-frozen-parameters')).toContainText('growth');
    await expect(offline.locator('.export-frozen-parameters')).toContainText('2');
    const viewSelect=offline.getByLabel('Saved dashboard view',{exact:true});
    const options= viewSelect.locator('option:not([value=""])');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveAttribute('disabled','');
    await expect(options.nth(0)).toContainText('Disabled');
    await expect(options.nth(0)).toContainText('growth (saved 1; exported 2)');
    await expect(options.nth(1)).not.toHaveAttribute('disabled');
    await expect(options.nth(2)).toHaveAttribute('disabled','');
    await viewSelect.selectOption('matching');
    await offline.getByRole('button',{name:'Apply view',exact:true}).click();
    await expect(offline.locator('.tile-chart svg')).toContainText('20');
    await offline.evaluate(()=>{const select=document.querySelector('[aria-label="Saved dashboard view"]');select.value='old';});
    await offline.getByRole('button',{name:'Apply view',exact:true}).click();
    await expect(offline.locator('.tile-chart svg')).toContainText('20');
  } finally {await context.close();}
  await page.locator('#file-import').setInputFiles({name:'honest-export.html',mimeType:'text/html',buffer:Buffer.from(html)});
  await expect(page.locator('#status')).toContainText('Imported');
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).savedViews);
  expect(viewValues(restored)).toEqual(viewValues(views));
});

acceptImportConfirmation(test);
