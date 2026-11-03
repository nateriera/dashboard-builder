import { acceptImportConfirmation, configureImportContext } from './accept-import.js';
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const sourceRows = [
  { label:'Original A',region:'Mapped A',value:'12',extra:'Keep A' },
  { label:'Original B',region:'Mapped B',value:'7',extra:'Keep B' }
];
const sourceCsv = 'label,region,value,extra\nOriginal A,Mapped A,12,Keep A\nOriginal B,Mapped B,7,Keep B';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

async function emptyDashboard(page) {
  await ready(page);
  await page.locator('#file-import').setInputFiles({ name:'source-records.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'dashboard-builder',version:1,tiles:[]})) });
  await expect(page.locator('#status')).toContainText('Imported');
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await expect(page.locator('.tile')).toHaveCount(1);
  return page.locator('.tile');
}

async function readRecords(details) {
  return details.evaluate(node => {
    const keys = [...node.querySelectorAll('thead th')].map(cell => cell.querySelector('button').getAttribute('aria-label').slice('Sort by '.length));
    return [...node.querySelectorAll('tbody tr')].map(row => Object.fromEntries([...row.querySelectorAll('td')].map((cell,index) => [keys[index],cell.textContent])));
  });
}

async function expectSourceData(tile) {
  const details = tile.locator('.chart-data:not(.chart-drillthrough)');
  await details.locator('summary').click();
  await expect(details.locator('tbody tr')).toHaveCount(2);
  expect(await readRecords(details)).toEqual(sourceRows);
  await details.locator('summary').click();
}

async function expectMappedChart(tile) {
  await expect(tile.locator('.tile-chart svg')).toBeVisible();
  await expect(tile.locator('.tile-error')).toHaveCount(0);
  await expect(tile.locator('svg [aria-label^="Category: Mapped A"]')).toHaveCount(1);
  await expect(tile.locator('svg [aria-label^="Category: Mapped B"]')).toHaveCount(1);
  await expect(tile.locator('svg')).toContainText('12');
}

async function expectSelectedSource(tile, { composer = true } = {}) {
  await tile.locator('svg [aria-label^="Category: Mapped A"]').click();
  const details = tile.locator('.chart-drillthrough');
  await expect(details).toHaveCount(1);
  if (composer) await tile.getByRole('button', { name:'Inspect 1 selected record',exact:true }).click();
  await expect(details.locator('tbody tr')).toHaveCount(1);
  expect(await readRecords(details)).toEqual([sourceRows[0]]);
  // Selection resolves against the mapped chart key even though records show the original label.
  await expect(tile.locator('svg [aria-label^="Category: Mapped A"]')).toHaveCount(1);
}

async function bindSource(page, tile, kind) {
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  if (kind === 'upload') {
    await pop.getByRole('button', { name:'Upload',exact:true }).click();
    await pop.locator('.data-drop input').setInputFiles({ name:'source-records.csv',mimeType:'text/csv',buffer:Buffer.from(sourceCsv) });
    await expect(pop.locator('.data-filename')).toContainText('2 rows, 4 columns');
  } else {
    await pop.getByRole('button', { name:'SQL',exact:true }).click();
    await expect(pop.locator('.data-sql-run')).toBeEnabled({timeout:90000});
    await pop.getByLabel('SQL query', {exact:true}).fill("SELECT 'Original A' AS label, 'Mapped A' AS region, '12' AS value, 'Keep A' AS extra UNION ALL SELECT 'Original B', 'Mapped B', '7', 'Keep B' ORDER BY region");
    await pop.locator('.data-sql-run').click();
    await expect(pop.locator('.data-sql-status')).toHaveText('2 rows');
  }
  const panel = pop.locator('.data-panel:visible');
  await panel.locator('.data-mapping select[data-field-key="label"]').selectOption('region');
  await panel.locator('.data-mapping select[data-field-key="value"]').selectOption('value');
  await panel.getByRole('button', { name:'Apply to tile',exact:true }).click();
  await expect(pop).toHaveCount(0);
}

for (const kind of ['upload', 'query']) {
  test(`S3: ${kind} source views retain colliding original columns while mapped charts and Inspect stay correct`, async ({ page, browser }) => {
    test.setTimeout(120000);
    const tile = await emptyDashboard(page);
    await bindSource(page, tile, kind);
    await expectMappedChart(tile);
    await expectSourceData(tile);

    if (kind === 'query') {
      const downloading = page.waitForEvent('download');
      await page.locator('#btn-export-html').click();
      const html = await fs.readFile(await (await downloading).path(), 'utf8');
      const context = await browser.newContext(); await configureImportContext(context);
      try {
        await context.setOffline(true);
        const offline = await context.newPage();
        await offline.route('**/*', route => route.abort());
        await offline.setContent(html, {waitUntil:'load'});
        const exportedTile = offline.locator('.export-tile');
        await expect(exportedTile).toHaveCount(1);
        await expectMappedChart(exportedTile);
        await expectSourceData(exportedTile);
        await expectSelectedSource(exportedTile, {composer:false});
      } finally { await context.close(); }
    }

    await expectSelectedSource(tile);
  });
}

test('S3: guided chart datasets retain every raw column and source views preserve original values', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-data').click();
  await page.locator('.data-popover .data-drop input').setInputFiles({ name:'guided-source-records.csv',mimeType:'text/csv',buffer:Buffer.from(sourceCsv) });
  const dialog = page.locator('.guided-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.guided-suggestion')).toHaveCount(1);
  await dialog.getByLabel('Bar chart: Label column', {exact:true}).selectOption('region');
  page.once('dialog', event => event.accept());
  await dialog.getByRole('button', { name:'Build selected charts',exact:true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.tile')).toHaveCount(1);
  const tile = page.locator('.tile');
  await expectMappedChart(tile);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1'))?.tiles.length ?? 0)).toBe(1);
  const dataset = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('dashboard-builder:layout:v1'));
    return (await import('/src/data/store.js')).getDataset(saved.tiles[0].dataset.slice('upload:'.length));
  });
  expect(dataset.mapping).toEqual({ label:'region',value:'value' });
  expect(dataset.rows[0]).toMatchObject({ label:'Mapped A',value:12 });
  expect(dataset.raw).toEqual({ columns:['label','region','value','extra'],rows:sourceRows });
  await expectSourceData(tile);
  await expectSelectedSource(tile);
});

acceptImportConfirmation(test);
