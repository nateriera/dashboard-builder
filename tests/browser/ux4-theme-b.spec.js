import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

test('wrangling controls rebuild after the source column is renamed', async ({page}) => {
  await ready(page);
  await page.evaluate(async () => {
    const { saveDataset } = await import('/src/data/store.js');
    const { toggleWranglingPopover } = await import('/src/ui/dataWranglingPopover.js');
    const anchor = document.querySelector('.tile-title');
    const meta = { id: 'ux4-wrangle', type: 'bar', dataset: 'categorical', tileOptions: {} };
    toggleWranglingPopover({ anchor, type: 'bar', meta, dashboard: { table: null }, getParameters: () => [] });
    const columns = ['Renamed category', 'amount'];
    const raw = { columns, rows: [{ 'Renamed category': 'North', amount: 4 }] };
    const upload = saveDataset({ name: 'renamed.csv', columns, rows: raw.rows, fieldKeys: columns, mapping: {}, raw });
    meta.dataset = `upload:${upload.id}`;
    saveDataset({ name: 'change signal.csv', columns: ['other'], rows: [{ other: 'x' }], fieldKeys: ['other'], mapping: {} });
  });
  const dialog = page.getByRole('dialog', {name: 'Data wrangling'});
  const grouping = dialog.getByLabel('Grouping 1 column');
  await expect(grouping.locator('option', {hasText: 'Renamed category'})).toHaveCount(1, {timeout: 30000});
  await expect(grouping).toHaveValue('Renamed category');
});

test('guided build disables every dialog control and reports its failing step inside the dialog', async ({page}) => {
  await ready(page);
  await page.evaluate(async () => {
    const { openGuidedStart } = await import('/src/ui/guidedStart.js');
    openGuidedStart({
      name: 'broken.csv', id: 'upload-test',
      profile: { rowCount: 2, sampledRows: 2, fields: [
        { name: 'Month', kind: 'date', uniqueDates: true, distinctCount: 2, missingCount: 0 },
        { name: 'Volume', kind: 'number', distinctCount: 2, missingCount: 0 }
      ] },
      onUseData() {}, onKeep() {},
      onApply: async () => { await new Promise(resolve => setTimeout(resolve, 250)); return { error: 'Persisting chart dataset 1 of 1: simulated failure' }; }
    });
  });
  const dialog = page.getByRole('dialog', {name: 'Review uploaded data and dashboard suggestions'});
  const build = dialog.getByRole('button', {name: 'Build selected charts'});
  await build.click();
  await expect(dialog.locator('input:enabled, select:enabled, textarea:enabled, button:enabled')).toHaveCount(0);
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('Persisting chart dataset 1 of 1');
  await expect(dialog.getByRole('button', {name: 'Keep current dashboard'})).toBeEnabled();
  await expect(dialog.locator('select').first()).toBeEnabled();
});
