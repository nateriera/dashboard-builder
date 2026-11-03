import { acceptExportSnapshotConfirmation, acceptImportConfirmation } from './accept-import.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

const querySql = `SELECT label, value * {{factor}} AS value FROM upload_sales /* <img src=x onerror="window.queryMarkupRan=true"> */`;
const queryName = 'Imported sales query';
const tile = (id, pageId) => ({
  id, type:'table', title:id, source:'SQL', dataset:'query:imported-sales',
  binding:{mode:'explicit',ref:'query:imported-sales'}, pageId,
  x:0,y:0,w:8,h:18,sizing:'manual',tileOptions:{}
});
const scenario = {
  app:'dashboard-builder',version:4,rowHeight:24,theme:'paper',
  defaultDataset:{kind:'samples'},pages:[{id:'overview',name:'Overview'},{id:'detail',name:'Detail'}],currentPageId:'overview',
  tiles:[tile('active-query','overview'),tile('inactive-query','detail')],
  queries:{'imported-sales':{name:queryName,sql:querySql,columns:['label','value'],fieldKeys:['label','value'],mapping:{},dependencies:['upload:sales'],trusted:true}},
  filters:[{id:'initial-filter',field:'label',op:'is',values:['North']}],
  parameters:[{name:'factor',type:'number',value:1}]
};

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible()) await hint.getByRole('button',{name:'Got it'}).click();
}

async function watchExecution(page) {
  await page.addInitScript(() => { window.queryExecutions = []; });
  await page.route('**/src/data/duckdb.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    let instrumented = source;
    for (const name of ['getCachedRows', 'runTileQuery', 'runQuery', 'runQueryDetailed']) {
      instrumented = instrumented.replace(new RegExp(`(export (?:async )?function ${name}\\([^)]*\\) \\{)`),
        `$1 globalThis.queryExecutions.push('${name}');`);
    }
    expect(instrumented).not.toBe(source);
    await route.fulfill({response,body:instrumented});
  });
}

async function expectNoExecution(page) {
  expect(await page.evaluate(() => window.queryExecutions)).toEqual([]);
  await expect(page.locator('.tile-chart tbody tr')).toHaveCount(0);
}

async function expectReview(tileEl) {
  await expect(tileEl.locator('.tile-query-review')).toContainText(queryName);
  await expect(tileEl.locator('.tile-query-review')).toContainText('This query came from an imported file and has not run yet.');
  await expect(tileEl.locator('.tile-query-sql')).toHaveText(querySql);
  await expect(tileEl.locator('.tile-chart img')).toHaveCount(0);
  await expect(tileEl.getByRole('button',{name:'Review query',exact:true})).toBeVisible();
}

test('T1: imported queries stay blocked through page/filter/parameter changes, exports, and reload until Run then Apply', async ({page}, testInfo) => {
  test.setTimeout(120000);
  await watchExecution(page);
  await ready(page);
  // The recipient already has this private upload; the imported file contains none of its rows.
  await page.evaluate(async () => {
    const {restoreDatasets} = await import('/src/data/store.js');
    await restoreDatasets({sales:{name:'Recipient private sales',columns:['label','value'],rows:[{label:'North',value:12},{label:'South',value:30}],fieldKeys:[],mapping:{},raw:null}});
  });
  expect(scenario.datasets).toBeUndefined();
  await page.locator('#file-import').setInputFiles({name:'imported-query.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scenario))});
  await expect(page.locator('#status')).toContainText('Imported');
  const active = page.locator('.grid-stack-item[gs-id="active-query"]');
  await expectReview(active);
  await expectNoExecution(page);
  expect(await page.evaluate(async () => (await import('/src/data/queries.js')).getQuery('imported-sales').trusted)).toBe(false);

  await page.locator('#btn-filters').click();
  await page.getByRole('button',{name:'Remove label filter'}).click();
  await page.locator('.dashboard-filters-popover').getByRole('tab',{name:'Parameters'}).click();
  await page.getByLabel('Value for factor').fill('2');
  await page.getByLabel('Value for factor').press('Tab');
  await page.getByRole('button',{name:'Close filters and parameters'}).click();
  await expectReview(active);
  await page.getByRole('tab',{name:'Detail',exact:true}).click();
  await expectReview(page.locator('.grid-stack-item[gs-id="inactive-query"]'));
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await expectReview(active);
  await expectNoExecution(page);

  page.once('dialog',dialog => dialog.accept());
  let downloading = page.waitForEvent('download');
  await clickHeaderAction(page,'#btn-export');
  let download = await downloading;
  const backup = JSON.parse(await fs.readFile(await download.path(),'utf8'));
  expect(backup.queries['imported-sales'].trusted).toBe(false);
  expect(backup.omittedDependencies.join(' ')).toContain('query:imported-sales');
  await expectNoExecution(page);

  downloading = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  download = await downloading;
  const html = await fs.readFile(await download.path(),'utf8');
  const payload = JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  expect(payload.tiles).toHaveLength(2);
  for (const exported of payload.tiles) {
    expect(exported.rows).toBeNull();
    expect(exported.error).toBeTruthy();
  }
  await expectNoExecution(page);

  await clickHeaderAction(page,'#btn-save');
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expectReview(active);
  await expectNoExecution(page);
  expect(await page.evaluate(async () => (await import('/src/data/queries.js')).getQuery('imported-sales').trusted)).toBe(false);
  await active.screenshot({path:testInfo.outputPath('imported-query-review.png')});

  await active.getByRole('button',{name:'Review query',exact:true}).click();
  await expect(page.getByLabel('SQL query', {exact:true})).toHaveValue(querySql);
  await expect(page.locator('.data-panel:visible .data-apply')).toBeDisabled();
  await expect(page.locator('.data-sql-run')).toBeEnabled({timeout:90000});
  await expectNoExecution(page);
  await page.getByRole('button', {name:'Group & summarize', exact:true}).click();
  await expect(page.locator('.wrangling-popover [role="alert"]').first()).toContainText('Run it, then Apply');
  await expectNoExecution(page);
  await page.locator('.wrangling-popover').getByRole('button', {name:'Close', exact:true}).click();
  await active.getByRole('button', {name:'Review query', exact:true}).click();
  await expect(page.locator('.data-sql-run')).toBeEnabled();
  await page.locator('.data-sql-run').click();
  await expect(page.locator('.data-sql-status')).toHaveText('2 rows',{timeout:90000});
  await expect(page.locator('.data-panel:visible .data-preview tbody')).toContainText('North');
  await expect(page.locator('.data-panel:visible .data-preview tbody')).toContainText('60');
  // Run reviews a result; only Apply creates the new trusted record and rebinds this tile.
  expect(await page.evaluate(async () => (await import('/src/data/queries.js')).getQuery('imported-sales').trusted)).toBe(false);
  await expect(active.locator('.tile-chart tbody tr')).toHaveCount(0);
  await page.locator('.data-panel:visible .data-apply').click();
  await expect(active.locator('.db-data-table tbody tr')).toHaveCount(2);
  await expect(active.locator('.db-data-table')).toContainText('60');
  await expect(active.getByRole('button',{name:'Review query',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => window.queryMarkupRan)).toBeUndefined();

  await clickHeaderAction(page,'#btn-save');
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expect(active.locator('.db-data-table tbody tr')).toHaveCount(2);
  await expect(active.locator('.db-data-table')).toContainText('60');
  const trusted = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dashbuilder.queries.v1')).items).filter(query => query.trusted));
  expect(trusted).toHaveLength(1);
  expect(trusted[0].sql).toBe(querySql);
  await page.getByRole('tab',{name:'Detail',exact:true}).click();
  await expectReview(page.locator('.grid-stack-item[gs-id="inactive-query"]'));
});

acceptImportConfirmation(test);
acceptExportSnapshotConfirmation(test);
