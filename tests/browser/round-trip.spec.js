import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
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

  const context = await browser.newContext();
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
