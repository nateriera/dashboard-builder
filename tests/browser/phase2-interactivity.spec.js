import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const tile = (id, type, dataset, y, tileOptions = {}) => ({
  id, type, title: id.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`), source: 'Bundled sample data', dataset,
  binding: { mode: 'explicit', ref: dataset },
  tileOptions, sizing: 'manual', x: 0, y, w: 6, h: 15
});

const envelope = tiles => ({
  app: 'dashboard-builder', version: 3, rowHeight: 24, theme: 'paper',
  defaultDataset: { kind: 'samples' }, tiles
});

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
}

async function importJSON(page, data) {
  await page.locator('#file-import').setInputFiles({
    name: 'phase2-fixture.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data))
  });
  await expect(page.locator('#status')).toContainText('Imported');
}

async function openFilters(page, tab = 'Filters') {
  await page.locator('#btn-filters').click();
  const popover = page.locator('.dashboard-filters-popover');
  await expect(popover).toBeVisible();
  if (tab === 'Parameters') await popover.getByRole('tab', { name: tab }).click();
  return popover;
}

async function addCategoryFilter(page, field, value) {
  const popover = page.locator('.dashboard-filters-popover');
  await popover.getByRole('button', { name: 'Add filter' }).click();
  await popover.getByLabel('Filter field').selectOption(field);
  await popover.getByRole('checkbox', { name: value, exact: true }).check();
  await popover.getByRole('button', { name: 'Apply filter' }).click();
}

function exportPayload(html) {
  const match = html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('HTML export is missing its dashboard payload.');
  return JSON.parse(match[1]);
}

test('Phase 2 filters apply by source field, persist, export resolved rows, and show a neutral empty state', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([
    tile('housing-requests', 'bar', 'categorical', 0),
    tile('scatter-without-label', 'scatter', 'scatter', 16)
  ]));
  const bar = page.locator('.grid-stack-item[gs-id="housing-requests"]');
  const scatter = page.locator('.grid-stack-item[gs-id="scatter-without-label"]');
  await expect(bar.locator('.chart-data summary')).toContainText('(8 rows)');
  await expect(scatter.locator('.chart-data summary')).toContainText('(24 rows)');

  const popover = await openFilters(page);
  await addCategoryFilter(page, 'label', 'Housing');
  await expect(bar.locator('.chart-data summary')).toContainText('(1 rows)');
  await expect(scatter.locator('.chart-data summary')).toContainText('(24 rows)');
  await expect(popover).toContainText('Choose which charts a filter controls');
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await popover.screenshot({ path: 'docs/screenshots/phase2/filters.png' });

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  const backupFile = await jsonDownload;
  const backup = JSON.parse(await fs.readFile(await backupFile.path(), 'utf8'));
  expect(backup.filters).toEqual([{ id: expect.any(String), field: 'label', op: 'is', values: ['Housing'] }]);

  await page.locator('#btn-save').click();
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('#status')).toContainText('build');
  await page.locator('#btn-filters').click();
  await expect(page.locator('.dashboard-filter-chip')).toContainText('label is Housing');
  await page.locator('#btn-filters').click();

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const htmlFile = await htmlDownload;
  const htmlText = await fs.readFile(await htmlFile.path(), 'utf8');
  const payload = exportPayload(htmlText);
  expect(payload.filters).toEqual([{ id: expect.any(String), field: 'label', op: 'is', values: ['Housing'] }]);
  expect(payload.tiles.find(item => item.title === 'Housing Requests').rows).toHaveLength(8);
  const offline = await page.context().newPage();
  await offline.route('**/dashboard-offline.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: htmlText }));
  await offline.goto('/dashboard-offline.html');
  await expect(offline.locator('.export-filters')).toBeVisible();
  const offlineFilter = offline.getByLabel('label values');
  await offlineFilter.selectOption([JSON.stringify('Food'), JSON.stringify('Health')]);
  await expect.poll(() => offlineFilter.evaluate(select => [...select.selectedOptions].map(option => option.value)))
    .toEqual(expect.arrayContaining([JSON.stringify('Food'), JSON.stringify('Health')]));
  const offlineData = offline.locator('.export-tile').first().locator('.chart-data');
  await expect(offlineData.locator('summary')).toContainText('(2 rows)');
  await offlineData.locator('summary').click();
  await expect(offlineData.locator('tbody')).toContainText('Food');
  await offline.close();

  await openFilters(page);
  await page.getByRole('button', { name: 'Remove label filter' }).click();
  await page.locator('.dashboard-filters-popover').getByRole('button', { name: 'Add filter' }).click();
  await page.locator('.dashboard-filters-popover').getByLabel('Filter source chart').selectOption('housing-requests');
  await page.locator('.dashboard-filters-popover').getByLabel('Filter field').selectOption('value');
  await page.getByLabel('Minimum').fill('99999999');
  await page.getByLabel('Maximum').fill('100000000');
  await page.locator('.dashboard-filters-popover').getByRole('button', { name: 'Apply filter' }).click();
  await expect(bar.locator('.tile-empty')).toHaveText('No rows match the active filters.');
  await expect(bar.locator('.tile-error')).toHaveCount(0);
});

test('Desktop parity: saved views capture and restore filters across reloads', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([tile('view-chart', 'bar', 'categorical', 0)]));
  page.once('dialog', dialog => dialog.accept('All cases'));
  await page.locator('#btn-save-view').click();
  await page.locator('#btn-filters').click();
  await addCategoryFilter(page, 'label', 'Housing');
  await page.locator('#btn-filters').click();
  page.once('dialog', dialog => dialog.accept('Housing view'));
  await page.locator('#btn-save-view').click();
  await expect(page.locator('#saved-view-picker')).toHaveValue(/view-/);

  await page.locator('#btn-filters').click();
  await page.getByRole('button', { name: 'Remove label filter' }).click();
  await page.locator('#btn-filters').click();
  await expect(page.locator('.grid-stack-item[gs-id="view-chart"] .chart-data summary')).toContainText('(8 rows)');
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('.grid-stack-item[gs-id="view-chart"] .chart-data summary')).toContainText('(1 rows)');
  await page.locator('#btn-save').click();
  await page.reload();
  await expect(page.locator('#saved-view-picker')).toContainText('Housing view');
  await page.locator('#saved-view-picker').selectOption({ label: 'Housing view' });
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('.grid-stack-item[gs-id="view-chart"] .chart-data summary')).toContainText('(1 rows)');
  const htmlDownload=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const htmlFile=await htmlDownload, html=await fs.readFile(await htmlFile.path(),'utf8'), payload=exportPayload(html);
  expect(payload.savedViews.map(view=>view.name)).toEqual(['All cases','Housing view']);
  const offline=await page.context().newPage();await offline.setContent(html);
  await offline.locator('.export-saved-views select').selectOption({label:'All cases'});
  await offline.getByRole('button',{name:'Apply view'}).click();
  await expect(offline.locator('.export-grid:visible .chart-data summary')).toContainText('(8 rows)');
  await offline.locator('.export-saved-views select').selectOption({label:'Housing view'});
  await offline.getByRole('button',{name:'Apply view'}).click();
  await expect(offline.locator('.export-grid:visible .chart-data summary')).toContainText('(1 rows)');
});

test('Desktop parity: pages retain separate tile layouts and page-scoped filters in the offline export', async ({ page, context }) => {
  await ready(page);
  await importJSON(page, envelope([tile('overview-chart', 'bar', 'categorical', 0)]));
  page.once('dialog', dialog => dialog.accept('Detail'));
  await page.getByRole('button', { name: 'Add dashboard page' }).click();
  await page.getByRole('tab', { name: 'Detail' }).click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(0);
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(1);
  const detailTileId = await page.locator('.grid-stack-item').getAttribute('gs-id');

  const filters = await openFilters(page);
  await filters.getByRole('button', { name: 'Add filter' }).click();
  await filters.getByLabel('Filter source chart').selectOption(detailTileId);
  await filters.getByLabel('Filter field').selectOption('label');
  await filters.getByLabel('Filter scope').selectOption('page');
  await filters.getByLabel('Filter page').selectOption({ label: 'Detail' });
  await filters.getByRole('checkbox', { name: 'Housing', exact: true }).check();
  await filters.getByRole('button', { name: 'Apply filter' }).click();
  await filters.getByRole('button', { name: 'Close filters and parameters' }).click();
  await expect(page.locator(`.grid-stack-item[gs-id="${detailTileId}"] .chart-data summary`)).toContainText('(1 rows)');
  await page.getByRole('tab', { name: 'Page 1' }).click();
  await expect(page.locator('.grid-stack-item[gs-id="overview-chart"] .chart-data summary')).toContainText('(8 rows)');
  await page.getByRole('tab', { name: 'Detail' }).click();

  await page.locator('#btn-save').click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.grid-stack-item .chart-data summary')).toContainText('(1 rows)');
  const jsonDownload = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  const backup = JSON.parse(await fs.readFile(await (await jsonDownload).path(), 'utf8'));
  expect(backup.version).toBe(4);
  expect(backup.pages.map(item => item.name)).toEqual(['Page 1', 'Detail']);
  expect(backup.tiles.map(item => item.pageId)).toEqual([backup.pages[0].id, backup.pages[1].id]);

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const htmlFile = await htmlDownload;
  const exported = await context.newPage();
  await exported.setContent(await fs.readFile(await htmlFile.path(), 'utf8'));
  await expect(exported.locator('.export-page-tabs')).toBeVisible();
  await expect(exported.locator('.export-grid:visible .export-tile')).toHaveCount(1);
  await exported.getByRole('tab', { name: 'Page 1' }).click();
  await expect(exported.locator('.export-grid:visible .export-tile')).toHaveCount(1);
});

test('Desktop parity: configured mark destinations navigate with the selected value in editor and offline viewer', async ({ page, context }) => {
  await ready(page);
  const source=tile('source-page-chart','bar','categorical',0,{clickDestinationPageId:'detail'});
  source.pageId='page-1';
  const target=tile('detail-page-chart','bar','categorical',0);target.pageId='detail';
  const data={...envelope([source,target]),version:4,pages:[{id:'page-1',name:'Overview'},{id:'detail',name:'Detail'}],currentPageId:'page-1'};
  await importJSON(page,data);
  await page.locator('.grid-stack-item[gs-id="source-page-chart"] .tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(page.getByRole('tab',{name:'Detail'})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.grid-stack-item[gs-id="detail-page-chart"] .chart-data summary')).toContainText('(1 rows)');
  await page.getByRole('tab',{name:'Overview'}).click();
  await page.locator('.grid-stack-item[gs-id="source-page-chart"] .tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(page.locator('.grid-stack-item[gs-id="detail-page-chart"] .chart-data summary')).toContainText('(8 rows)');

  const htmlDownload=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const file=await htmlDownload, exported=await context.newPage(), html=await fs.readFile(await file.path(),'utf8');
  const payload=exportPayload(html);expect(payload.tiles.find(item=>item.id==='detail-page-chart').rows[0]).toHaveProperty('label');
  await exported.setContent(html);
  await expect(exported.locator('.export-page-tabs')).toBeVisible();
  await exported.getByRole('tab',{name:'Overview'}).click();
  await exported.locator('.export-grid:visible .export-tile svg [aria-label^="Category: "]').first().click();
  await expect(exported.locator('.export-page-tabs button[aria-selected="true"]')).toHaveText('Detail');
  await expect(exported.locator('.export-crossfilter-chip')).toHaveCount(1);
  await expect(exported.locator('.export-grid:visible .chart-data summary')).toContainText('(1 rows)');
});

test('Phase 2 bar and donut cross-filters exclude their source, show a chip, and toggle off', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([
    tile('source-bar', 'bar', 'categorical', 0),
    tile('other-bar', 'bar', 'categorical', 16),
    tile('category-donut', 'donut', 'categorical', 32)
  ]));
  const sourceBar = page.locator('.grid-stack-item[gs-id="source-bar"]');
  const otherBar = page.locator('.grid-stack-item[gs-id="other-bar"]');
  const donut = page.locator('.grid-stack-item[gs-id="category-donut"]');
  await expect(sourceBar.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(8 rows)');
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(sourceBar.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(8 rows)');
  await expect(sourceBar.locator('.chart-drillthrough summary')).toContainText('(1 rows)');
  await expect(otherBar.locator('.chart-data summary')).toContainText('(1 rows)');

  const popover = await openFilters(page);
  await expect(popover.locator('[data-crossfilter-chip="true"]')).toContainText('label is Housing');
  await expect(popover.locator('[data-crossfilter-chip="true"]').first()).toContainText('Source Bar');
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await popover.screenshot({ path: 'docs/screenshots/phase2/crossfilter-chip.png' });
  await page.locator('#btn-filters').click();
  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click({position:{x:20,y:20}});
  await expect(donut.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(1 rows)');
  await expect(otherBar.locator('.chart-data summary')).toContainText('(1 rows)');
  const independent = await openFilters(page);
  await expect(independent.locator('[data-crossfilter-chip="true"]')).toHaveCount(2);
  await expect(independent.locator('[data-crossfilter-chip="true"]').last()).toContainText('Category Donut');
  await page.locator('#btn-filters').click();
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  const oneLeft = await openFilters(page);
  await expect(oneLeft.locator('[data-crossfilter-chip="true"]')).toHaveCount(1);
  await expect(oneLeft.locator('[data-crossfilter-chip="true"]').first()).toContainText('Category Donut');
  await expect(otherBar.locator('.chart-data summary')).toContainText('(1 rows)');
  await page.locator('#btn-filters').click();
  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click({position:{x:20,y:20}});
  await expect(otherBar.locator('.chart-data summary')).toContainText('(8 rows)');
});

test('Desktop parity: cross-filter selections from different source charts remain independent', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([
    tile('source-bar', 'bar', 'categorical', 0),
    tile('other-bar', 'bar', 'categorical', 16),
    tile('category-donut', 'donut', 'categorical', 32)
  ]));
  const sourceBar=page.locator('.grid-stack-item[gs-id="source-bar"]');
  const otherBar=page.locator('.grid-stack-item[gs-id="other-bar"]');
  const donut=page.locator('.grid-stack-item[gs-id="category-donut"]');
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click({position:{x:20,y:20}});
  const popover=await openFilters(page);
  await expect(popover.locator('[data-crossfilter-chip="true"]')).toHaveCount(2);
  await expect(popover.locator('[data-crossfilter-chip="true"]').first()).toContainText('Source Bar');
  await expect(popover.locator('[data-crossfilter-chip="true"]').last()).toContainText('Category Donut');
  await page.locator('#btn-filters').click();
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  const remaining=await openFilters(page);
  await expect(remaining.locator('[data-crossfilter-chip="true"]')).toHaveCount(1);
  await expect(remaining.locator('[data-crossfilter-chip="true"]')).toContainText('Category Donut');
  await page.locator('#btn-filters').click();
  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click({position:{x:20,y:20}});
  await expect(otherBar.locator('.chart-data summary')).toContainText('(8 rows)');
});

test('Desktop parity: target charts can filter, highlight, or ignore incoming selections', async ({ page }) => {
  await ready(page);
  await importJSON(page,envelope([tile('source','bar','categorical',0),tile('target','bar','categorical',16)]));
  const source=page.locator('.grid-stack-item[gs-id="source"]');
  const target=page.locator('.grid-stack-item[gs-id="target"]');
  await target.locator('.tile-settings summary').click();
  await target.getByLabel('Incoming cross-filter behavior').selectOption('highlight');
  await source.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(target.locator('.chart-data summary')).toContainText('(8 rows)');
  await expect(target.locator('.tile-chart svg a[data-crossfilter-selected="true"]')).toHaveCount(1);
  await expect(target.locator('.tile-chart svg a[data-crossfilter-selected="false"]').first()).toBeVisible();
  await target.getByLabel('Incoming cross-filter behavior').selectOption('none');
  await expect(target.locator('.chart-data summary')).toContainText('(8 rows)');
  await expect(target.locator('.tile-chart svg [data-crossfilter-selected]')).toHaveCount(0);
});

test('Desktop parity: explicit field mapping highlights differently named chart fields', async ({page})=>{
  await ready(page);
  const data=envelope([
    {...tile('source','bar','upload:source',0),binding:{mode:'explicit',ref:'upload:source'}},
    {...tile('target','scatter','upload:target',16),binding:{mode:'explicit',ref:'upload:target'}}
  ]);
  data.datasets={
    source:{name:'Categories',columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'},rows:[{label:'Housing',value:3},{label:'Employment',value:2}]},
    target:{name:'Grouped points',columns:['x','y','group'],fieldKeys:['x','y','group'],mapping:{x:'x',y:'y',group:'group'},rows:[{x:1,y:2,group:'Housing'},{x:2,y:3,group:'Employment'}]}
  };
  await importJSON(page,data);
  const source=page.locator('.grid-stack-item[gs-id="source"]'),target=page.locator('.grid-stack-item[gs-id="target"]');
  await target.locator('.tile-settings summary').click();
  await target.getByLabel('Incoming cross-filter behavior').selectOption('highlight');
  await target.getByLabel('Highlight mapping from label').selectOption('group');
  await source.locator('.tile-chart svg [aria-label^="Category: Housing"]').click();
  await expect(target.locator('.tile-chart svg a[data-crossfilter-selected="true"]')).toHaveCount(1);
  await expect(target.locator('.tile-chart svg a[data-crossfilter-selected="false"]')).toHaveCount(1);
  await source.locator('.tile-chart svg [aria-label^="Category: Housing"]').click();
  const download=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const html=await fs.readFile(await (await download).path(),'utf8');
  const offline=await page.context().newPage();
  await offline.route('**/mapped-fields.html',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await offline.goto('/mapped-fields.html');
  const offlineSource=offline.locator('.export-tile').first(),offlineTarget=offline.locator('.export-tile').last();
  await offlineSource.locator('.tile-chart svg [aria-label^="Category: Housing"]').click();
  await expect(offlineTarget.locator('.tile-chart svg a[data-crossfilter-selected="true"]')).toHaveCount(1);
  await expect(offlineTarget.locator('.tile-chart svg a[data-crossfilter-selected="false"]')).toHaveCount(1);
  await offline.close();
});

test('Desktop parity: mark clicks can filter charts or inspect records independently', async ({ page }) => {
  await ready(page);
  await importJSON(page,envelope([tile('source','bar','categorical',0),tile('target','bar','categorical',16)]));
  const source=page.locator('.grid-stack-item[gs-id="source"]');
  const target=page.locator('.grid-stack-item[gs-id="target"]');
  await source.locator('.tile-settings summary').click();
  await source.getByLabel('Mark click action').selectOption('inspect-only');
  await source.locator('.tile-settings summary').click();
  await source.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(source.locator('.chart-drillthrough summary')).toContainText('(1 rows)');
  await source.locator('.chart-drillthrough [aria-label="Search records in Source — selected mark"]').fill('Housing');
  await expect(source.locator('.chart-drillthrough tbody')).toContainText('Housing');
  await source.locator('.chart-drillthrough [aria-label="Sort by value"]').click();
  await expect(source.locator('.chart-drillthrough [aria-label="Rows per page"]')).toHaveValue('100');
  await expect(target.locator('.chart-data summary')).toContainText('(8 rows)');
  await source.locator('.tile-settings summary').click();
  await source.getByLabel('Mark click action').selectOption('filter-only');
  await source.locator('.tile-settings summary').click();
  await source.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(target.locator('.chart-data summary')).toContainText('(1 rows)');
  await expect(source.locator('.chart-drillthrough')).toHaveCount(0);
});

test('Desktop parity: date range controls filter a tile and chart type switching preserves its data binding', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([tile('monthly-trend', 'line', 'timeseries', 0)]));
  const chart = page.locator('.grid-stack-item[gs-id="monthly-trend"]');
  const popover = await openFilters(page);
  await popover.getByRole('button', { name: 'Add filter' }).click();
  await popover.getByLabel('Filter source chart').selectOption('monthly-trend');
  await popover.getByLabel('Filter field').selectOption('date');
  await page.getByLabel('Start date').fill('2026-01-01');
  await page.getByLabel('End date').fill('2026-02-28');
  await popover.getByRole('button', { name: 'Apply filter' }).click();
  await expect(chart.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(4 rows)');
  await page.locator('#btn-filters').click();

  await chart.locator('.tile-settings summary').click();
  await chart.getByLabel('Chart type').selectOption('area');
  await expect(chart.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(4 rows)');
  await page.locator('#btn-save').click();
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('.grid-stack-item[gs-id="monthly-trend"] .chart-data summary')).toContainText('(4 rows)');
});

test('Desktop parity: relative year-to-date date filter uses calendar boundaries', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([tile('monthly-trend', 'line', 'timeseries', 0)]));
  const chart=page.locator('.grid-stack-item[gs-id="monthly-trend"]');
  const popover=await openFilters(page);
  await popover.getByRole('button',{name:'Add filter'}).click();
  await popover.getByLabel('Filter source chart').selectOption('monthly-trend');
  await popover.getByLabel('Filter field').selectOption('date');
  await popover.getByLabel('Date range preset').selectOption('year-to-date');
  await popover.getByRole('button',{name:'Apply filter'}).click();
  const expectedRows=await page.evaluate(()=>2*(new Date().getUTCMonth()+1));
  await expect(chart.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText(`(${expectedRows} rows)`);
  await expect(popover.locator('.dashboard-filter-chip')).toContainText('Year to date');
});

test('Desktop parity: time-series brushing applies a date range to other charts', async ({page})=>{
  await ready(page);
  await importJSON(page,envelope([tile('brush-source','line','timeseries',0),tile('brush-target','line','timeseries',16)]));
  const source=page.locator('.grid-stack-item[gs-id="brush-source"]');
  const target=page.locator('.grid-stack-item[gs-id="brush-target"]');
  await expect(source.locator('.chart-data summary')).toContainText('(24 rows)');
  const svg=source.locator('.tile-chart svg[viewBox]:not([width="15"])');
  const box=await svg.boundingBox();
  await page.mouse.move(box.x+box.width*0.3,box.y+box.height*0.45);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*0.7,box.y+box.height*0.45,{steps:6});
  await expect(source.locator('.tile-chart svg .db-time-brush')).toHaveCount(1);
  await page.mouse.up();
  await expect(target.locator('.chart-data summary')).not.toContainText('(24 rows)');
  await expect(target.locator('.chart-data summary')).not.toContainText('(0 rows)');
  const filters=await openFilters(page);
  await expect(filters.locator('[data-crossfilter-chip="true"]')).toContainText('Brush Source');
});

test('Desktop parity: offline viewer supports time-series brushing and reset', async ({page})=>{
  await ready(page);
  await importJSON(page,envelope([tile('offline-brush-source','line','timeseries',0),tile('offline-brush-target','line','timeseries',16)]));
  const download=page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const html=await fs.readFile(await (await download).path(),'utf8');
  const offline=await page.context().newPage();
  await offline.route('**/offline-brush.html',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await offline.goto('/offline-brush.html');
  const source=offline.locator('.export-tile').first(),target=offline.locator('.export-tile').last();
  await expect(target.locator('.chart-data summary')).toContainText('(24 rows)');
  const svg=source.locator('.tile-chart svg[viewBox]');const box=await svg.boundingBox();
  await offline.mouse.move(box.x+box.width*.3,box.y+box.height*.45);await offline.mouse.down();
  await offline.mouse.move(box.x+box.width*.7,box.y+box.height*.45,{steps:6});await offline.mouse.up();
  await expect(target.locator('.chart-data summary')).not.toContainText('(24 rows)');
  await expect(target.locator('.chart-data summary')).not.toContainText('(0 rows)');
  await expect(source.locator('.tile-chart svg[viewBox] .db-time-brush')).toHaveCount(1);
  await expect(offline.locator('.export-crossfilter-chip')).toContainText('Offline Brush Source: date');
  await offline.getByRole('button',{name:'Reset filters'}).click();
  await expect(target.locator('.chart-data summary')).toContainText('(24 rows)');
  await expect(source.locator('.tile-chart svg[viewBox] .db-time-brush')).toHaveCount(0);
  await expect(offline.locator('.export-crossfilter-chip')).toHaveCount(0);
  await offline.close();
});

test('Phase 2 SQL parameters define, substitute, re-run, export, and report missing names', async ({ page }) => {
  test.setTimeout(120000);
  await ready(page);
  await importJSON(page, envelope([tile('parameterized-chart', 'bar', 'categorical', 0)]));

  let popover = await openFilters(page, 'Parameters');
  await popover.getByRole('button', { name: 'Add parameter' }).click();
  let form = popover.locator('.parameter-form');
  await form.getByLabel('New parameter name').fill('growth');
  await form.getByLabel('New parameter value').fill('1');
  await form.getByLabel('Parameter minimum').fill('0');
  await form.getByLabel('Parameter maximum').fill('2');
  await form.getByRole('button', { name: 'Create parameter' }).click();

  await popover.getByRole('button', { name: 'Add parameter' }).click();
  form = popover.locator('.parameter-form');
  await form.getByLabel('New parameter name').fill('owner');
  await form.getByLabel('Type').selectOption('text');
  await form.getByLabel('New parameter value').fill("O'Brien");
  await form.getByRole('button', { name: 'Create parameter' }).click();
  await expect(popover.getByLabel('Value for growth')).toBeVisible();
  await expect(popover.getByLabel('Value for owner')).toHaveValue("O'Brien");
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await popover.screenshot({ path: 'docs/screenshots/phase2/parameters.png' });

  await page.locator('#btn-filters').click();
  await page.locator('#btn-save').click();
  await expect(page.locator('#status')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('#status')).toContainText('build');
  popover = await openFilters(page, 'Parameters');
  await expect(popover.getByLabel('Value for growth')).toHaveValue('1');
  await expect(popover.getByLabel('Value for owner')).toHaveValue("O'Brien");
  await page.locator('#btn-filters').click();

  const tileEl = page.locator('.grid-stack-item[gs-id="parameterized-chart"]');
  await tileEl.locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  await expect(page.locator('.data-sql-run')).toBeEnabled({ timeout: 90000 });
  await page.locator('.data-sql-input').fill("SELECT {{owner}} AS label, SUM(value) * {{growth}} AS value FROM categorical WHERE label = 'Housing'");
  await page.locator('.data-sql-run').click();
  await expect(page.locator('.data-sql-status')).toHaveText('1 row', { timeout: 90000 });
  await expect(page.locator('.data-panel:visible .data-apply')).toBeEnabled();
  await page.locator('.data-panel:visible .data-apply').click();
  await expect(tileEl.locator('.chart-data summary')).toContainText('(1 rows)', { timeout: 90000 });
  await page.locator('#btn-filters').click();
  await tileEl.locator('.chart-data summary').click();
  await expect(tileEl.locator('.chart-data tbody')).toContainText("O'Brien");
  await expect(tileEl.locator('.chart-data tbody')).toContainText('12840');

  popover = await openFilters(page, 'Parameters');
  await popover.getByLabel('Value for growth').evaluate(input => {
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(tileEl.locator('.chart-data summary')).toContainText('(1 rows)', { timeout: 90000 });
  await popover.getByRole('button', { name: 'Close filters and parameters' }).click();
  await tileEl.locator('.chart-data summary').click();
  await expect(tileEl.locator('.chart-data tbody')).toContainText('25680', { timeout: 90000 });

  const jsonDownload = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  const backupFile = await jsonDownload;
  const backup = JSON.parse(await fs.readFile(await backupFile.path(), 'utf8'));
  expect(backup.parameters).toEqual([
    { name: 'growth', type: 'number', value: 2, min: 0, max: 2 },
    { name: 'owner', type: 'text', value: "O'Brien" }
  ]);

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const htmlFile = await htmlDownload;
  const payload = exportPayload(await fs.readFile(await htmlFile.path(), 'utf8'));
  expect(payload.tiles.find(item => item.title === 'Parameterized Chart').rows).toEqual([{ label: "O'Brien", value: 25680 }]);

  popover = await openFilters(page, 'Parameters');
  await popover.getByRole('button', { name: 'Delete parameter owner' }).click();
  await expect(tileEl.locator('.tile-error')).toContainText('Unknown SQL parameter "owner"', { timeout: 90000 });
});

test('Phase 2 reference lines render zero and negative values with a label', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([tile('reference-target', 'bar', 'categorical', 0, { referenceValue: 0, referenceLabel: 'Target' })]));
  const tileEl = page.locator('.grid-stack-item[gs-id="reference-target"]');
  await expect(tileEl.locator('.tile-chart svg').last()).toContainText('Target');
  await tileEl.locator('details.tile-settings > summary').click();
  const reference = tileEl.getByLabel('Reference value');
  await reference.fill('-5');
  await reference.press('Tab');
  await expect(tileEl.locator('.tile-chart svg').last()).toContainText('Target');
  await expect(tileEl.locator('.tile-chart svg [stroke-dasharray="5,4"]')).toHaveCount(1);
  await reference.fill('6500');
  await reference.press('Tab');
  await tileEl.locator('details.tile-settings > summary').click();
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await tileEl.screenshot({ path: 'docs/screenshots/phase2/reference-line.png' });
});

test('Phase 2 sort then top-N keeps the selected categories and whole stacked groups', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([
    tile('top-categories', 'bar', 'categorical', 0, { sort: 'asc', topN: 3 }),
    tile('top-stacked-groups', 'stackedBar', 'stacked', 16, { topN: 2 })
  ]));
  const bar = page.locator('.grid-stack-item[gs-id="top-categories"]');
  const stacked = page.locator('.grid-stack-item[gs-id="top-stacked-groups"]');
  await expect(bar.locator('.chart-data summary')).toContainText('(3 rows)');
  await expect(stacked.locator('.chart-data summary')).toContainText('(6 rows)');
  await bar.locator('.chart-data summary').click();
  const ascending = await bar.locator('.chart-data tbody tr').evaluateAll(rows => rows.map(row => row.cells[0].textContent));
  expect(ascending).toEqual(['Other', 'Legal aid', 'Childcare']);

  await bar.locator('details.tile-settings > summary').click();
  await bar.getByLabel('Sort',{exact:true}).selectOption('desc');
  const topN = bar.getByLabel('Show top N categories');
  await topN.fill('2');
  await topN.press('Tab');
  await expect(bar.locator('.chart-data summary')).toContainText('(2 rows)');
  await bar.locator('details.tile-settings > summary').click();
  await bar.locator('.chart-data summary').click();
  await expect(bar.locator('.chart-data tbody tr')).toHaveCount(2);
  const descending = await bar.locator('.chart-data tbody tr').evaluateAll(rows => rows.map(row => row.cells[0].textContent));
  expect(descending).toEqual(['Housing', 'Employment']);
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await bar.screenshot({ path: 'docs/screenshots/phase2/sort-top-n.png' });
});
