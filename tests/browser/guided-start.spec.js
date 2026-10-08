import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

async function uploadMetrics(page) {
  await page.locator('#btn-data').click();
  await page.locator('.data-popover .data-drop input').setInputFiles({
    name: 'metrics.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'date,revenue,cost,units,region',
      '2026-01-01,10,7,3,North',
      '2026-01-02,14,8,4,South',
      '2026-01-03,18,9,5,West'
    ].join('\n'))
  });
  await expect(page.locator('.guided-dialog')).toBeVisible();
}

test('guided upload profiles locally, permits field choice, and builds only after replacement confirmation', async ({ page }) => {
  await ready(page);
  const originalTiles = await page.locator('.tile').count();
  await uploadMetrics(page);

  await expect(page.locator('.guided-stats strong').nth(0)).toHaveText('3');
  await expect(page.locator('.guided-stats strong').nth(1)).toHaveText('5');
  await expect(page.locator('.guided-field')).toHaveCount(5);
  await expect(page.locator('.guided-suggestion')).toHaveCount(3);
  await page.getByLabel('Scatter plot: Y column').selectOption('units');

  let prompt = '';
  page.once('dialog', async (dialog) => {
    prompt = dialog.message();
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Build selected charts' }).click();
  await expect(page.locator('.guided-dialog')).toBeHidden();
  await expect(page.locator('.tile')).toHaveCount(3);
  expect(originalTiles).toBeGreaterThan(0);
  expect(prompt).toContain('Replace the current dashboard');
  await expect(page.locator('#status')).toContainText('Built 3 suggested charts');

  const downloadEvent = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export');
  const download = await downloadEvent;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  const scatter = exported.tiles.find((tile) => tile.type === 'scatter');
  const chartData = exported.datasets[scatter.dataset.slice('upload:'.length)];
  expect(chartData.mapping).toEqual({ x: 'revenue', y: 'units' });
  expect(chartData.rows[0]).toMatchObject({ x: 10, y: 3 });
});

test('guided upload can be dismissed while preserving the active dashboard', async ({ page }) => {
  await ready(page);
  const before = await page.evaluate(() => localStorage.getItem('dashboard-builder:layout:v1'));
  const tileCount = await page.locator('.tile').count();
  await uploadMetrics(page);
  await page.getByRole('button', { name: 'Keep current dashboard' }).click();
  await expect(page.locator('.guided-dialog')).toBeHidden();
  await expect(page.locator('.tile')).toHaveCount(tileCount);
  expect(await page.evaluate(() => localStorage.getItem('dashboard-builder:layout:v1'))).toBe(before);
  await expect(page.locator('#status')).toContainText('Current dashboard kept');
});
