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
  const context = await browser.newContext();
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
});
