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
  await expect(popover.locator('[data-crossfilter-chip="true"]')).toContainText('Source Bar');
  await fs.mkdir('docs/screenshots/phase2', { recursive: true });
  await popover.screenshot({ path: 'docs/screenshots/phase2/crossfilter-chip.png' });
  await page.locator('#btn-filters').click();
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(otherBar.locator('.chart-data summary')).toContainText('(8 rows)');

  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click();
  await expect(donut.locator('.chart-data:not(.chart-drillthrough) summary')).toContainText('(8 rows)');
  await expect(otherBar.locator('.chart-data summary')).toContainText('(1 rows)');
  const donutFilter = await openFilters(page);
  await expect(donutFilter.locator('[data-crossfilter-chip="true"]')).toContainText('label is Housing');
  await expect(donutFilter.locator('[data-crossfilter-chip="true"]')).toContainText('Category Donut');
  await page.locator('#btn-filters').click();

  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  const replacement = await openFilters(page);
  await expect(replacement.locator('[data-crossfilter-chip="true"]')).toContainText('Source Bar');
  await page.locator('#btn-filters').click();
  await sourceBar.locator('.tile-chart svg [aria-label^="Category: "]').first().click();
  await expect(otherBar.locator('.chart-data summary')).toContainText('(8 rows)');

  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click();
  await expect(otherBar.locator('.chart-data summary')).toContainText('(1 rows)');
  await donut.locator('.tile-chart svg path[data-crossfilter-values]').first().click();
  await expect(otherBar.locator('.chart-data summary')).toContainText('(8 rows)');
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
  await bar.getByLabel('Sort').selectOption('desc');
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
