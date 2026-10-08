import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

const envelope = (tiles, datasets = {}, queries = {}) => ({
  app: 'dashboard-builder', version: 1, theme: 'paper', tiles, datasets, queries
});
const tile = (dataset = 'categorical', opts = {}) => ({
  id: 't1', type: 'bar', dataset, title: 'Requests by category', x: 0, y: 0, w: 6, h: 5, ...opts
});

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

async function dismissHint(page) {
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) {
    await hint.getByRole('button', { name: 'Got it' }).click();
  }
}

async function openSql(page) {
  await page.locator('.tile-data-btn').first().click();
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
}

async function importJSON(page, data) {
  await page.locator('#file-import').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data))
  });
  await expect(page.locator('#status')).toContainText(/Imported|Import failed/);
}

test('prelaunch: add bar then dot gets a distinct title and templates keep explicit titles', async ({ page }) => {
  await ready(page);
  page.once('dialog', dialog => dialog.accept());
  await clickHeaderAction(page, '#btn-clear');
  await expect(page.locator('.tile')).toHaveCount(0);

  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await page.locator('.palette-item[data-tile-type="dot"]').click();
  const titles = page.locator('.tile [aria-label="Tile title"]');
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveValue('Requests by category');
  await expect(titles.nth(1)).toHaveValue('Requests by category 2');
  await page.screenshot({ path: 'docs/screenshots/tile-title-disambiguation.png' });

  await clickHeaderAction(page, '#btn-templates');
  const overview = page.locator('.tpl-card').filter({ hasText: 'Executive overview' });
  await overview.getByRole('button', { name: 'Use template' }).click();
  await overview.getByRole('button', { name: 'Replace' }).click();
  await expect(titles).toHaveCount(5);
  const restoredTitles = await page.locator('.tile [aria-label="Tile title"]').evaluateAll(inputs => inputs.map(input => input.value));
  expect(restoredTitles).toContain('Monthly volume');
  expect(restoredTitles).toContain('Requests by category');
});

test('prelaunch: starter templates show bundled images and user templates keep schematic previews', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dashbuilder.templates.v1', JSON.stringify([{
    id: 'user-example', name: 'My private layout', tiles: [
      { type: 'bar', x: 0, y: 0, w: 6, h: 5, title: 'Local data', dataset: 'categorical' }
    ], screenshot: 'https://example.invalid/private-preview.png'
  }])));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await ready(page);
  await dismissHint(page);
  await clickHeaderAction(page, '#btn-templates');
  await expect(page.locator('.tpl-card')).toHaveCount(7);
  await expect(page.locator('.tpl-preview.has-screenshot img')).toHaveCount(6);
  await page.waitForFunction(() => [...document.querySelectorAll('.tpl-preview img')]
    .every(image => image.complete && image.naturalWidth > 0));
  const imageOrigins = await page.locator('.tpl-preview img').evaluateAll(images =>
    [...new Set(images.map(image => new URL(image.src).origin))]);
  expect(imageOrigins).toEqual([new URL(page.url()).origin]);
  const user = page.locator('.tpl-card').filter({ hasText: 'My private layout' });
  await expect(user.locator('.tpl-preview img')).toHaveCount(0);
  await expect(user.locator('.tpl-preview .tpl-block')).toHaveCount(1);
  await page.locator('.tpl-modal').screenshot({ path: 'docs/screenshots/template-gallery-previews.png' });
});

test('prelaunch: first-run hint is non-modal, does not shift the grid, persists dismissal, and stays out of present mode', async ({ page }) => {
  await ready(page);
  const hint = page.locator('.first-run-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Charts: drag one onto the grid or click to add it.');
  await expect(hint).toContainText('Data button binds samples, uploads, or SQL');
  await expect(hint).toContainText('Export HTML');
  const before = await page.locator('#grid-wrap').boundingBox();
  await page.screenshot({ path: 'docs/screenshots/first-run-hint.png' });
  await page.locator('.palette-item[data-tile-type="dot"]').click();
  await expect(page.locator('.tile')).toHaveCount(6);
  await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('dashbuilder.seenHint.v1'))).toBe('1');
  expect(await page.locator('#grid-wrap').boundingBox()).toEqual(before);
  await page.reload();
  await expect(page.locator('#status')).toContainText('build');
  await expect(page.locator('.first-run-hint')).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem('dashbuilder.seenHint.v1'));
  await page.reload();
  await expect(page.locator('.first-run-hint')).toBeVisible();
  await page.locator('#btn-present').click();
  await expect(page.locator('body')).toHaveClass(/present/);
  await expect(page.locator('.first-run-hint')).toHaveCount(0);
});

test('prelaunch: slow DuckDB loading shows progressive status without changing the fast path', async ({ page }) => {
  await page.route('**/src/data/duckdb.js*', async route => {
    await new Promise(resolve => setTimeout(resolve, 5500));
    await route.continue();
  });
  await ready(page);
  await dismissHint(page);
  await openSql(page);
  await expect(page.locator('.data-sql-status')).toHaveText(
    'Still loading the in-browser database (one-time ~39 MB download)…', { timeout: 7500 }
  );
  await page.screenshot({ path: 'docs/screenshots/sql-loading-slow.png' });
  await expect(page.locator('.data-sql-run')).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('.data-sql-status')).toHaveText('DuckDB ready');
  await expect(page.locator('.data-sql-retry')).toBeHidden();
});

test('prelaunch: DuckDB load failure shows an error and Retry load recovers', async ({ page }) => {
  test.setTimeout(120000);
  let faultInjected = false;
  await page.route('**/src/data/duckdb.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'async function initDB() {';
    if (!source.includes(marker)) throw new Error('DuckDB initDB marker not found for the forced-failure check.');
    faultInjected = true;
    const failedOnce = source.replace(marker,
      'let failFirstInit = true;\nasync function initDB() {\n  if (failFirstInit) { failFirstInit = false; throw new Error("DuckDB could not be initialized."); }');
    await route.fulfill({ response, body: failedOnce });
  });
  await ready(page);
  await dismissHint(page);
  await openSql(page);
  await expect(page.locator('.data-sql-status')).toHaveText('DuckDB failed to load');
  await expect(page.locator('.data-error').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry loading the in-browser database' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/sql-load-retry.png' });
  await page.getByRole('button', { name: 'Retry loading the in-browser database' }).click();
  await expect(page.locator('.data-sql-run')).toBeEnabled({ timeout: 90000 });
  await expect(page.locator('.data-sql-status')).toHaveText('DuckDB ready');
  await expect(page.locator('.data-error').last()).toBeHidden();
  expect(faultInjected).toBe(true);
});

test('docs #4: map a synthetic CSV onto an imported tile with a missing upload reference', async ({ page }) => {
  await ready(page);
  await dismissHint(page);
  await importJSON(page, envelope([tile('upload:missing')]));
  await expect(page.locator('.tile-error')).toContainText('The saved reference upload:missing is missing');

  await page.locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.locator('.data-popover .data-drop input').setInputFiles({
    name: 'service-requests.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Category,Requests\nHousing,12\nFood,7\nHealth,5')
  });
  await expect(page.locator('.data-popover .data-filename')).toContainText('3 rows, 2 columns');
  const mapping = page.locator('.data-popover .data-panel:visible .data-mapping select');
  await mapping.nth(0).selectOption('Category');
  await mapping.nth(1).selectOption('Requests');
  await expect(page.getByRole('button', { name: 'Apply to tile' })).toBeEnabled();
  await page.screenshot({ path: 'docs/screenshots/csv-field-mapping.png' });
  await page.getByRole('button', { name: 'Apply to tile' }).click();
  await expect(page.locator('.tile-error')).toHaveCount(0);
  await expect(page.locator('.tile-chart svg')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/csv-missing-reference-repaired.png' });
});

test('docs #5: exact categorical SQL aggregation runs, previews, and maps to a tile', async ({ page }) => {
  await ready(page);
  await dismissHint(page);
  await openSql(page);
  await expect(page.locator('.data-sql-run')).toBeEnabled();
  await page.locator('.data-sql-input').fill(
    'SELECT label, SUM(value) AS value FROM categorical GROUP BY label ORDER BY value DESC'
  );
  await page.locator('.data-sql-run').click();
  await expect(page.locator('.data-sql-status')).toHaveText('8 rows');
  await expect(page.locator('.data-panel:visible .data-preview')).toBeVisible();
  await expect(page.locator('.data-panel:visible .data-preview')).toContainText('Housing');
  await expect(page.getByRole('button', { name: 'Apply to tile' })).toBeEnabled();
  await page.screenshot({ path: 'docs/screenshots/sql-aggregation-recipe.png' });
  await expect(page.locator('.data-panel:visible .data-mapping select').nth(0)).toHaveValue('label');
  await expect(page.locator('.data-panel:visible .data-mapping select').nth(1)).toHaveValue('value');
});

test('docs #6: JSON backup is editable in the composer and HTML viewer opens offline', async ({ page, browser }) => {
  await ready(page);
  await dismissHint(page);
  const jsonDownload = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export');
  const jsonFile = await jsonDownload;
  const backup = JSON.parse(await fs.readFile(await jsonFile.path(), 'utf8'));
  expect(backup.tiles.length).toBeGreaterThan(0);
  await page.locator('#file-import').setInputFiles({
    name: 'dashboard-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#status')).toContainText('Imported');
  await page.screenshot({ path: 'docs/screenshots/json-backup-composer.png' });

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const htmlFile = await htmlDownload;
  const html = await fs.readFile(await htmlFile.path(), 'utf8');
  expect(html).toContain('dashboard-export');
  expect(html).not.toContain('__DASHBOARD_PAYLOAD__');
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await viewer.route('**/*', route => route.abort());
  await context.setOffline(true);
  await viewer.setContent(html, { waitUntil: 'load' });
  await expect(viewer.locator('.export-tile svg').first()).toBeVisible();
  await viewer.screenshot({ path: 'docs/screenshots/html-sharing-viewer.png' });
  await context.close();
});
