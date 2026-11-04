import { acceptImportConfirmation } from './accept-import.js';
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const hint=page.locator('.first-run-hint');
  if(await hint.isVisible().catch(()=>false))await hint.getByRole('button',{name:'Got it'}).click();
}

async function openParameters(page) {
  await page.locator('#btn-filters').click();
  const popover=page.locator('.dashboard-filters-popover');
  await popover.getByRole('tab',{name:'Parameters'}).click();
  return popover;
}

test('S1-B blocks rename, delete, and type changes for every consumer kind, then detaches visibly and allows the rename',async({page})=>{
  await ready(page);
  const ids=await page.evaluate(async()=>{
    const {saveQuery}=await import('/src/data/queries.js');
    const sql=saveQuery({name:'Sales SQL report',sql:'SELECT {{growth}} AS value',columns:['value'],fieldKeys:['value'],mapping:{value:'value'}});
    const chain={version:1,source:{sql:'SELECT 1 AS ordinal, {{growth}} AS value',dependencies:[],schema:{columns:['ordinal','value'],types:{ordinal:'Int32',value:'Int64'}},order:{kind:'columns',fields:['ordinal']}},steps:[],outputMapping:{}};
    const chained=saveQuery({name:'Sales transform',chain,dependencies:[]});
    return {sql:sql.id,chain:chained.id};
  });
  const layout={app:'dashboard-builder',version:1,parameters:[{name:'growth',type:'number',value:2},{name:'unused',type:'number',value:7}],savedViews:[{id:'prior',name:'Prior growth',theme:'paper',currentPageId:'page-1',filters:[],parameters:[{name:'growth',type:'number',value:1}]}],tiles:[
    {id:'sql-tile',type:'table',title:'Sales SQL report',dataset:`query:${ids.sql}`,x:0,y:0,w:6,h:7},
    {id:'chain-tile',type:'table',title:'Sales transform',dataset:`query:${ids.chain}`,x:6,y:0,w:6,h:7}
  ]};
  await page.locator('#file-import').setInputFiles({name:'parameter-consumers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');

  let popover=await openParameters(page);
  const growth=popover.locator('.dashboard-parameter').nth(0);
  const name=growth.getByLabel('Rename parameter growth');
  await name.fill('gain');await name.press('Tab');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Cannot rename parameter');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Query “Sales SQL report”');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Transform chain “Sales transform”');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Saved view “Prior growth”');

  await growth.getByLabel('Type for growth').selectOption('text');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Cannot change the type of parameter');
  await expect(growth.getByLabel('Type for growth')).toHaveValue('number');
  await growth.getByRole('button',{name:'Delete parameter growth'}).click();
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Cannot delete parameter');
  await name.fill('gain2');await name.press('Tab');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Cannot rename parameter');

  await growth.getByRole('button',{name:'Detach query SQL consumers'}).click();
  await expect(page.locator('.grid-stack-item[gs-id="sql-tile"] .tile-error')).toContainText('explicitly detached query SQL');
  await expect(growth.locator('.parameter-consumer-warning')).toContainText('Transform chain “Sales transform”');
  await growth.getByRole('button',{name:'Detach transform chain consumers'}).click();
  await expect(page.locator('.grid-stack-item[gs-id="chain-tile"] .tile-error')).toContainText('explicitly detached transform-chain');
  await growth.getByRole('button',{name:'Detach saved view consumers'}).click();
  await expect(popover.getByLabel('Rename parameter growth')).toHaveCount(0);
  await expect(popover.getByLabel('Value for gain2')).toHaveValue('2');
  await expect(page.locator('#saved-view-picker option[value="prior"]')).toContainText('Missing parameter: growth');

  const unused=popover.locator('.dashboard-parameter').nth(1);
  await unused.getByLabel('Type for unused').selectOption('text');
  await expect(popover.getByLabel('Value for unused')).toHaveValue('7');
  await popover.getByLabel('Rename parameter unused').fill('spare');
  await popover.getByLabel('Rename parameter unused').press('Tab');
  await popover.getByRole('button',{name:'Delete parameter spare'}).click();
  await expect(popover.getByLabel('Rename parameter spare')).toHaveCount(0);

  await page.locator('#btn-saved-views').click();
  await page.locator('#saved-view-picker').selectOption('prior');
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('#status')).toContainText('Detached parameter bindings: growth');
  popover=await openParameters(page);
  await expect(popover.getByLabel('Rename parameter growth')).toHaveCount(0);
  await expect(popover.getByLabel('Rename parameter gain2')).toHaveCount(0);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')||'null')?.savedViews?.some(view=>view.id==='prior'&&view.brokenParameters?.includes('growth')));
  await page.reload();
  await expect(page.locator('.grid-stack-item[gs-id="sql-tile"] .tile-error')).toContainText('explicitly detached query SQL');
  await expect(page.locator('.grid-stack-item[gs-id="chain-tile"] .tile-error')).toContainText('explicitly detached transform-chain');
  await expect(page.locator('#saved-view-picker option[value="prior"]')).toContainText('Missing parameter: growth');
});

acceptImportConfirmation(test);
