import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

async function stubConfirms(page, answer = true) {
  await page.addInitScript((initialAnswer) => {
    window.__ux4ConfirmMessages = [];
    window.__ux4ConfirmAnswer = initialAnswer;
    window.confirm = message => { window.__ux4ConfirmMessages.push(message); return window.__ux4ConfirmAnswer; };
  }, answer);
}

test('chart type changes confirm only when non-default chart options will be lost', async ({page}) => {
  await stubConfirms(page);
  await ready(page);
  const tile = page.locator('.grid-stack-item').nth(1);
  await tile.locator('.tile-settings summary').click();
  await tile.getByLabel('Chart type').selectOption('column');
  expect(await page.evaluate(() => window.__ux4ConfirmMessages)).toEqual([]);

  const nextTile = page.locator('.grid-stack-item').nth(1);
  await nextTile.locator('.tile-settings summary').click();
  await nextTile.getByLabel('Sort').selectOption('asc');
  await nextTile.getByLabel('Chart type').selectOption('bar');
  const messages = await page.evaluate(() => window.__ux4ConfirmMessages);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Sort');
});

test('export names errored tiles before writing the JSON file', async ({page}) => {
  await stubConfirms(page);
  await ready(page);
  const first = page.locator('.grid-stack-item').first();
  const title = await first.locator('.tile-title').inputValue();
  await first.locator('.tile-chart').evaluate(node => {
    const error = document.createElement('div'); error.className = 'tile-error'; error.textContent = 'Simulated render error'; node.append(error);
  });
  await page.locator('.header-more > summary').click();
  const download = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  await download;
  const messages = await page.evaluate(() => window.__ux4ConfirmMessages);
  expect(messages[0]).toContain(title);
  await expect(page.locator('#status')).toContainText(`errored tile data omitted: ${title}`);
});

test('persistence warnings survive later transient status updates until dismissed', async ({page}) => {
  await ready(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.locator('.header-more > summary').click();
  await page.locator('#btn-save').click();
  const warning = page.locator('#persistence-warning');
  await expect(warning).toContainText('Save failed: storage unavailable');
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('#status')).toContainText('Choose a saved view first');
  await expect(warning).toContainText('Save failed: storage unavailable');
  await page.getByRole('button', {name: 'Dismiss persistence warning'}).click();
  await expect(warning).toBeHidden();
});

test('dashboard upload validation failure replaces a previous success status', async ({page}) => {
  await ready(page);
  await page.locator('#status').evaluate(node => { node.textContent = 'Upload saved: previous.csv'; });
  await page.locator('#btn-data').click();
  const popover = page.getByRole('dialog', {name: 'Dashboard data'});
  const paste = popover.getByLabel('Paste tabular data');
  const headers = Array.from({length: 101}, (_, index) => `column${index + 1}`).join(',');
  const values = Array.from({length: 101}, () => '1').join(',');
  await paste.fill(`${headers}\n${values}`);
  await popover.getByRole('button', {name: 'Import pasted data'}).click();
  await expect(popover.locator('.data-error')).toContainText('Column limit is 100');
  await expect(page.locator('#status')).toContainText('Dashboard upload failed: Column limit is 100');
  await expect(page.locator('#status')).not.toContainText('Upload saved: previous.csv');
});

test('saving over an existing view confirms and names the view', async ({page}) => {
  await stubConfirms(page, false);
  await page.addInitScript(() => { window.prompt = () => 'Quarterly review'; });
  await ready(page);
  await page.locator('#btn-save-view').click();
  await page.locator('#btn-save-view').click();
  expect(await page.evaluate(() => window.__ux4ConfirmMessages)).toEqual(['Replace saved view “Quarterly review”?']);
  await expect(page.locator('#saved-view-picker option')).toHaveCount(2);
});

test('deleting a wrangling recipe confirms and names the recipe', async ({page}) => {
  await stubConfirms(page, false);
  await ready(page);
  await page.evaluate(async () => {
    const { saveWranglingRecipe } = await import('/src/data/wranglingRecipes.js');
    const { toggleWranglingPopover } = await import('/src/ui/dataWranglingPopover.js');
    saveWranglingRecipe({ id: 'ux4-recipe', name: 'Quarterly review', kind: 'pivot', groups: [{ column: 'category' }], aggregations: [{ column: 'value', operation: 'SUM', name: 'Total' }] });
    toggleWranglingPopover({ anchor: document.querySelector('.tile-title'), type: 'bar', meta: { id: 'recipe-tile', type: 'bar', dataset: 'categorical' }, dashboard: { table: null }, getParameters: () => [] });
  });
  const dialog = page.getByRole('dialog', {name: 'Data wrangling'});
  const recipe = dialog.locator('select[aria-label="Summary recipe"]');
  await recipe.selectOption('ux4-recipe');
  await dialog.getByRole('button', {name: 'Delete recipe'}).click();
  expect(await page.evaluate(() => window.__ux4ConfirmMessages)).toEqual(['Delete recipe “Quarterly review”?']);
  await expect(recipe.locator('option[value="ux4-recipe"]')).toHaveCount(1);
});
