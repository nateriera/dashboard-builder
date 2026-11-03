import { acceptImportConfirmation, configureImportContext } from './accept-import.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

async function importLayout(page, layout) {
  await page.locator('#status').evaluate(node => { node.textContent = 'Reading round-trip fixture…'; });
  await page.locator('#file-import').setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(layout)) });
  await expect(page.locator('#status')).toContainText(/Imported|Import failed/);
}

test('R1: an app-created treemap parent mapping exports and imports intact in an empty profile', async ({ page, browser }) => {
  await ready(page);
  await importLayout(page, { app: 'dashboard-builder', version: 1, tiles: [] });
  await page.locator('.palette-item[data-tile-type="treemap"]').click();
  await page.locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const pop = page.locator('.data-popover');
  await pop.locator('.data-drop input').setInputFiles({ name: 'hierarchy.csv', mimeType: 'text/csv', buffer: Buffer.from('label,value,parent\nA,12,Programs\nB,7,Programs') });
  await expect(pop.locator('.data-filename')).toContainText('2 rows, 3 columns');
  await pop.getByLabel('Category column', { exact: true }).selectOption('label');
  await pop.getByLabel('Value column', { exact: true }).selectOption('value');
  await pop.getByLabel('Parent group', { exact: true }).selectOption('parent');
  await pop.getByRole('button', { name: 'Apply to tile', exact: true }).click();
  await expect(page.locator('.tile-chart svg')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export');
  const downloaded = await downloading;
  const exported = JSON.parse(await fs.readFile(await downloaded.path(), 'utf8'));
  const id = exported.tiles[0].dataset.slice('upload:'.length);
  expect(exported.datasets[id].mapping).toEqual({ label: 'label', value: 'value', parent: 'parent' });

  const context = await browser.newContext(); await configureImportContext(context);
  try {
    const fresh = await context.newPage();
    await ready(fresh);
    await importLayout(fresh, exported);
    await expect(fresh.locator('#status')).toContainText('Imported');
    await expect(fresh.locator('.tile-chart svg')).toBeVisible();
    const restored = await fresh.evaluate(async id => (await import('/src/data/store.js')).getDataset(id), id);
    expect(restored.mapping).toEqual(exported.datasets[id].mapping);
    expect(restored.rows.map(row => row.parent)).toEqual(['Programs', 'Programs']);
  } finally { await context.close(); }
});

const targetFilter = targets => ({ id:'connected',field:'label',op:'is',values:['Housing'],scope:'charts',targets:targets.map(tileId => ({ tileId,field:'label' })) });
const removalCases = [
  { name:'retargets a same-count filter to its surviving tile',filter:targetFilter(['remove','survivor']),remove:'remove',expected:[targetFilter(['survivor'])],updates:1 },
  { name:'drops a filter losing its final target',filter:targetFilter(['remove']),remove:'remove',expected:[],updates:1 },
  { name:'drops a crossfilter whose source tile is removed',filter:{ id:'crossfilter',field:'label',op:'is',values:['Housing'],source:'crossfilter',sourceTile:'remove' },remove:'remove',expected:[],updates:1 },
  { name:'keeps the autosave-only path when filters are unchanged',filter:targetFilter(['remove','survivor']),remove:'other',expected:[targetFilter(['remove','survivor'])],updates:0 }
];

for (const scenario of removalCases) {
  test(`R3: tile removal ${scenario.name} and survives reload`, async ({ page }) => {
    await page.addInitScript(() => { window.filterUpdateCalls = 0; });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const signature = 'function setFilters(next) {';
      expect(source).toContain(signature);
      await route.fulfill({ response,body:source.replace(signature, `${signature} globalThis.filterUpdateCalls++;`) });
    });
    await ready(page);
    const ids = scenario.remove === 'other' ? ['remove','survivor','other'] : ['remove','survivor'];
    await importLayout(page, {
      app:'dashboard-builder',version:1,
      tiles:ids.map((id,index) => ({ id,type:'bar',title:`Round-trip ${id}`,dataset:'categorical',x:(index % 2) * 6,y:Math.floor(index / 2) * 5,w:6,h:5 })),
      filters:[scenario.filter]
    });
    await expect(page.locator('#status')).toContainText('Imported');
    expect(await page.evaluate(() => window.filterUpdateCalls)).toBe(0);
    await page.locator(`.grid-stack-item[gs-id="${scenario.remove}"] .tile-remove`).click();
    await page.locator(`.grid-stack-item[gs-id="${scenario.remove}"] .tile-remove-confirm .tpl-confirm-yes`).click();
    const survivingIds = ids.filter(id => id !== scenario.remove).sort();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles.map(tile => tile.id).sort())).toEqual(survivingIds);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')));
    expect(saved.filters).toEqual(scenario.expected);
    expect(await page.evaluate(() => window.filterUpdateCalls)).toBe(scenario.updates);
    await page.reload();
    await expect(page.locator('#status')).toContainText('Layout restored from this browser');
    await expect(page.locator('.grid-stack-item')).toHaveCount(survivingIds.length);
    for (const id of survivingIds) await expect(page.locator(`.grid-stack-item[gs-id="${id}"]`)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).filters)).toEqual(scenario.expected);
  });
}

acceptImportConfirmation(test);
