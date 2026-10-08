import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

const datasets={
  table:'categorical',stackedBar:'stacked',stackedColumn:'stacked',histogram:'scatter',
  boxplot:'boxdata',area:'timeseries',heatmap:'heatmap',treemap:'treemap'
};
const types=['table','text','stackedBar','stackedColumn','histogram','boxplot','area','heatmap','treemap'];
const tile=(type,index)=>{
  const base={id:type,type,title:type,source:'Bundled sample data',x:0,y:index*16,w:12,h:type==='text'?6:15,sizing:'manual',tileOptions:{}};
  if(type==='text')return {...base,title:'Annotation',source:'',dataset:null,binding:{mode:'none'},tileOptions:{body:'Methodology\nAll values are synthetic.'}};
  const dataset=datasets[type];
  return {...base,dataset,binding:{mode:'explicit',ref:dataset},tileOptions:type.startsWith('stacked')?{mode:'stacked'}:type==='histogram'?{binCount:20}:{}};
};
const envelope={app:'dashboard-builder',version:3,rowHeight:24,theme:'paper',defaultDataset:{kind:'samples'},tiles:types.map(tile)};
async function ready(page){await page.goto('/');await expect(page.locator('#status')).toContainText('build');}
async function importJSON(page,data){await page.locator('#file-import').setInputFiles({name:'phase1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.locator('#status')).toContainText(/Imported|Import failed/);}

test('Phase 1 tiles bind samples, save annotations, export offline, and capture every new view',async({page},testInfo)=>{
  await ready(page);
  await importJSON(page,envelope);
  await expect(page.locator('.grid-stack-item')).toHaveCount(types.length);
  const hint=page.locator('.first-run-hint');
  if(await hint.count())await hint.getByRole('button',{name:'Got it'}).click();
  await fs.mkdir('docs/screenshots/phase1',{recursive:true});
  for(const type of types){
    const tile=page.locator(`.grid-stack-item[gs-id="${type}"]`);
    await expect(tile).toBeVisible();
    if(type==='table')await expect(tile.locator('.db-data-table')).toBeVisible();
    else if(type==='text')await expect(tile.locator('.db-annotation')).toContainText('All values are synthetic.');
    else await expect(tile.locator('.tile-chart svg').last()).toBeVisible();
    if(type==='stackedBar'||type==='stackedColumn')await expect(tile.locator('.tile-chart svg').last()).toContainText('North');
    await tile.screenshot({path:`docs/screenshots/phase1/${type}.png`});
  }

  const tableTile=page.locator('.grid-stack-item[gs-id="table"]');
  await tableTile.locator('.tile-data-btn').click();
  await page.locator('.data-tab').nth(1).click();
  await page.locator('.data-popover input[type=file]').setInputFiles({name:'table-source.csv',mimeType:'text/csv',buffer:Buffer.from('Record ID,Amount\n9007199254740993,12.5\n9007199254740994,18.25')});
  await expect(page.locator('.data-panel:not([hidden]) .data-preview-note')).toContainText('2 rows');
  await expect(page.locator('.data-panel:not([hidden]) .data-mapping')).toContainText('All source columns are kept');
  await page.locator('.data-panel:not([hidden]) .data-apply').click();
  await expect(tableTile.locator('thead th')).toHaveText(['Record ID','Amount']);
  await expect(tableTile.locator('tbody')).toContainText('9007199254740993');

  const stacked=page.locator('.grid-stack-item[gs-id="stackedBar"]');
  await stacked.locator('details.tile-settings > summary').click();
  await stacked.locator('select[aria-label="Mode"]').selectOption('grouped');
  await expect(stacked.locator('.tile-chart svg').last()).toContainText('North');
  const histogram=page.locator('.grid-stack-item[gs-id="histogram"]');
  await histogram.locator('details.tile-settings > summary').click();
  const bins=histogram.locator('input[aria-label="Bins"]');
  await expect(bins).toHaveValue('20');
  await bins.fill('8');await bins.press('Tab');await expect(bins).toHaveValue('8');

  const annotation=page.locator('.grid-stack-item[gs-id="text"]');
  await expect(annotation.locator('.tile-data-btn')).toBeHidden();
  await expect(annotation.locator('.tile-title')).toBeHidden();
  await annotation.locator('summary').click();
  const textarea=annotation.locator('textarea[aria-label="Text"]');
  await textarea.fill('Methodology\n<script>window.phase1Pwned=true</script>');
  await expect(annotation.locator('.db-annotation')).toContainText('<script>');
  await expect(annotation.locator('.db-annotation script')).toHaveCount(0);
  expect(await page.evaluate(()=>window.phase1Pwned)).toBeUndefined();
  await clickHeaderAction(page, '#btn-save');
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expect(annotation.locator('.db-annotation')).toContainText('<script>');
  await expect(annotation.locator('.tile-data-btn')).toBeHidden();
  const jsonDownload=page.waitForEvent('download');await clickHeaderAction(page, '#btn-export');
  const jsonFile=await jsonDownload;
  const saved=JSON.parse(await fs.readFile(await jsonFile.path(),'utf8'));
  expect(saved.tiles.find(t=>t.type==='text').binding).toEqual({mode:'none'});
  expect(saved.tiles.find(t=>t.type==='text').tileOptions.body).toContain('<script>');

  for(let i=0;i<4;i++){
    await clickHeaderAction(page, '#btn-theme');
    await page.locator('.theme-option').nth(i).click();
    await expect(page.locator('#status')).toContainText('Theme:');
    await page.locator('.grid-stack-item[gs-id="table"]').screenshot({path:`docs/screenshots/phase1/table-theme-${i+1}.png`});
  }

  const htmlDownload=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const htmlFile=await htmlDownload,html=await fs.readFile(await htmlFile.path(),'utf8');
  expect(html).not.toContain('__DASHBOARD_PAYLOAD__');
  const exported=await page.context().newPage();
  await exported.route('**/*',route=>route.abort());
  await exported.setContent(html,{waitUntil:'load'});
  await expect(exported.locator('.export-tile')).toHaveCount(types.length);
  await expect(exported.locator('.export-tile').filter({has:exported.locator('.db-annotation')})).toHaveCount(1);
  await expect(exported.locator('.export-tile .db-annotation')).toContainText('<script>');
  await expect(exported.locator('.export-tile svg').last()).toBeVisible();
  await testInfo.attach('standalone-export',{body:html,contentType:'text/html'});
  await exported.close();
});
