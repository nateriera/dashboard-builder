// Loose-threads slice (Nov 26, 2026), Part B gate G3: the layout-JSON
// export applies the same projection discipline as the HTML export.
//   - A tile-bound upload is inlined projected: columns no tile references
//     survive in neither `rows` nor `raw`, and re-importing the JSON
//     renders the tile identically.
//   - A saved query's stored `dependencies` list is never trusted for
//     inclusion (Amendment 1): a pre-fix query record that names an
//     upload its SQL never reads does not carry that upload into the JSON.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';
import { configureImportContext, acceptImportConfirmation } from './accept-import.js';

const SECRET_NAME = 'loose-threads-secret.csv';
const SECRET_CSV = 'slabel,sregion,svalue,sextra\nSentinelLabelA,SentinelRegionA,918273,SentinelExtraA\nSentinelLabelB,SentinelRegionB,564738,SentinelExtraB';
const OTHER_NAME = 'loose-threads-other.csv';
const OTHER_CSV = 'olabel,oregion,ovalue\nOtherLabelA,OtherRegionA,771942\nOtherLabelB,OtherRegionB,665283';
const OTHER_NEEDLES = ['loose-threads-other', 'olabel', 'oregion', 'ovalue', 'OtherLabelA', 'OtherLabelB', 'OtherRegionA', 'OtherRegionB', '771942', '665283'];

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

async function emptyDashboard(page) {
  await ready(page);
  await page.locator('#file-import').setInputFiles({ name: 'loose-threads-empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'dashboard-builder', version: 1, tiles: [] })) });
  await expect(page.locator('#status')).toContainText('Imported');
}

async function addTile(page, type) {
  const before = await page.locator('.tile').count();
  await page.locator(`.palette-item[data-tile-type="${type}"]`).click();
  await expect(page.locator('.tile')).toHaveCount(before + 1);
  const id = await page.locator('.grid-stack-item').nth(before).getAttribute('gs-id');
  return page.locator(`.grid-stack-item[gs-id="${id}"] .tile`);
}

async function uploadToTable(page, tile, name, csv, columns) {
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  await pop.getByRole('button', { name: 'Upload', exact: true }).click();
  await pop.locator('.data-drop input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(pop.locator('.data-filename')).toContainText(`2 rows, ${columns} columns`);
  await pop.locator('.data-panel:visible').getByRole('button', { name: 'Apply to tile', exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(tile.locator('.db-data-table tbody tr')).toHaveCount(2);
}

async function uploadIdNamed(page, name) {
  return page.evaluate(async (name) => (await import('/src/data/store.js')).listDatasets().find((ds) => ds.name === name).id, name);
}

async function exportJson(page) {
  const downloading = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export');
  return fs.readFile(await (await downloading).path(), 'utf8');
}

acceptImportConfirmation(test);

test('G3: JSON export projects a tile-bound upload (rows and raw) and re-imports rendering identically', async ({ page, browser }) => {
  test.setTimeout(150000);
  await emptyDashboard(page);
  const tile = await addTile(page, 'bar');
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  await pop.getByRole('button', { name: 'Upload', exact: true }).click();
  await pop.locator('.data-drop input').setInputFiles({ name: SECRET_NAME, mimeType: 'text/csv', buffer: Buffer.from(SECRET_CSV) });
  await expect(pop.locator('.data-filename')).toContainText('2 rows, 4 columns');
  const panel = pop.locator('.data-panel:visible');
  await panel.locator('.data-mapping select[data-field-key="label"]').selectOption('slabel');
  await panel.locator('.data-mapping select[data-field-key="value"]').selectOption('svalue');
  await panel.getByRole('button', { name: 'Apply to tile', exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(tile.locator('.tile-chart svg')).toBeVisible();
  const barsBefore = await tile.locator('.tile-chart svg rect, .tile-chart svg path').count();
  const id = await uploadIdNamed(page, SECRET_NAME);

  const json = await exportJson(page);
  const layout = JSON.parse(json);
  const dataset = layout.datasets?.[id];
  expect(dataset, 'the bound upload is inlined').toBeTruthy();
  // Referenced columns survive; unreferenced ones are gone from raw too.
  expect(dataset.raw.columns).toEqual(expect.arrayContaining(['slabel', 'svalue']));
  expect(dataset.raw.columns).not.toContain('sregion');
  expect(dataset.raw.columns).not.toContain('sextra');
  for (const row of dataset.rows) {
    expect(Object.keys(row)).not.toContain('sregion');
    expect(Object.keys(row)).not.toContain('sextra');
  }
  expect(json).not.toContain('SentinelRegion');
  expect(json).not.toContain('SentinelExtra');
  expect(json).not.toContain('sregion');
  expect(json).not.toContain('sextra');
  expect(json).toContain('SentinelLabelA');

  // Round-trip: a fresh context importing the JSON renders the same tile.
  const context = await browser.newContext();
  await configureImportContext(context);
  const imported = await context.newPage();
  try {
    await ready(imported);
    await imported.locator('#file-import').setInputFiles({ name: 'loose-threads-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(imported.locator('#status')).toContainText('Imported');
    const importedTile = imported.locator('.tile');
    await expect(importedTile).toHaveCount(1);
    await expect(importedTile.locator('.tile-chart svg')).toBeVisible();
    expect(await importedTile.locator('.tile-chart svg rect, .tile-chart svg path').count()).toBe(barsBefore);
  } finally { await context.close(); }
});

test('G3: JSON export ignores a stored dependency on an upload the query SQL never reads', async ({ page }) => {
  test.setTimeout(150000);
  await emptyDashboard(page);
  const holderA = await addTile(page, 'table');
  await uploadToTable(page, holderA, SECRET_NAME, SECRET_CSV, 4);
  const holderB = await addTile(page, 'table');
  await uploadToTable(page, holderB, OTHER_NAME, OTHER_CSV, 3);
  const otherId = await uploadIdNamed(page, OTHER_NAME);
  // Pre-fix record shape: the stored dependency list names the OTHER
  // upload, while the SQL reads only a built-in dataset.
  const qid = await page.evaluate(async (otherId) => (await import('/src/data/queries.js')).saveQuery({
    sql: 'SELECT label, value FROM categorical', columns: ['label', 'value'], fieldKeys: ['label', 'value'], mapping: {}, dependencies: [`upload:${otherId}`]
  }).id, otherId);
  await page.locator('#file-import').setInputFiles({ name: 'legacy-query.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'dashboard-builder', version: 1, tiles: [{ id: 'legacy', type: 'table', dataset: `query:${qid}`, x: 0, y: 0, w: 8, h: 10 }] })) });
  await expect(page.locator('#status')).toContainText('Imported');
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(8);

  const json = await exportJson(page);
  const layout = JSON.parse(json);
  expect(layout.datasets).toBeUndefined();
  for (const needle of OTHER_NEEDLES) expect(json, `exported JSON must not contain ${JSON.stringify(needle)}`).not.toContain(needle);
  expect(json).not.toContain('SentinelLabelA');
  expect(json).not.toContain('loose-threads-secret');
});
