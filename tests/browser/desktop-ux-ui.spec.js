import { test, expect } from '@playwright/test';

const tile = (id, type, dataset, y, tileOptions = {}) => ({
  id, type, title: id.replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`),
  source: 'Bundled sample data', dataset, binding: { mode: 'explicit', ref: dataset }, tileOptions,
  sizing: 'manual', x: 0, y, w: 6, h: 15
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
    name: 'desktop-ux-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))
  });
  await expect(page.locator('#status')).toContainText('Imported');
}

test('desktop toolbar fits, keeps primary actions visible, and groups secondary actions', async ({ page }) => {
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);
    const layout = await page.locator('#app-header').evaluate(header => {
      const status = document.querySelector('#status').getBoundingClientRect();
      const title = document.querySelector('.brand h1').getBoundingClientRect();
      return {
        width: innerWidth,
        scrollWidth: header.scrollWidth,
        clientWidth: header.clientWidth,
        statusRight: status.right,
        titleWidth: title.width,
        titleHeight: title.height
      };
    });
    expect(layout.scrollWidth, `header overflows at ${width}px`).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.statusRight, `status clips at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(layout.titleWidth).toBeGreaterThan(0);
    await expect(page.locator('#btn-data')).toBeVisible();
    await expect(page.locator('#btn-filters')).toBeVisible();
    await expect(page.locator('#btn-export-html')).toBeVisible();
    await expect(page.locator('.header-more > summary')).toBeVisible();
    await expect(page.locator('#btn-clear')).toBeHidden();
    await page.locator('.header-more > summary').click();
    await expect(page.locator('#btn-theme')).toBeVisible();
    await expect(page.locator('#btn-templates')).toBeVisible();
    await expect(page.locator('#btn-save')).toBeVisible();
    await expect(page.locator('#btn-export')).toBeVisible();
    await expect(page.locator('#btn-import')).toBeVisible();
    await expect(page.locator('#btn-clear')).toBeVisible();
  }
});

test('first-run help stays in the palette and never covers dashboard charts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint = page.locator('.first-run-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Charts: drag one onto the grid or click to add it.');
  expect(await hint.evaluate(el => !!el.closest('#palette'))).toBe(true);
  const overlaps = await hint.evaluate(el => {
    const a = el.getBoundingClientRect();
    return [...document.querySelectorAll('.tile-chart')].some(node => {
      const b = node.getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
  });
  expect(overlaps).toBe(false);
  await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toBeHidden();
});

test('cross-filter feedback names applied, ignored, and unmapped selections', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([
    tile('source', 'bar', 'categorical', 0),
    tile('target', 'bar', 'categorical', 16),
    tile('unmapped', 'scatter', 'scatter', 32)
  ]));
  const source = page.locator('.grid-stack-item[gs-id="source"]');
  const target = page.locator('.grid-stack-item[gs-id="target"]');
  const unmapped = page.locator('.grid-stack-item[gs-id="unmapped"]');

  await source.locator('.tile-chart svg [aria-label^="Category: Housing"]').click();
  await expect(target.locator('.tile-filter-status')).toContainText('Filtered by Source');
  await expect(target.locator('.tile-filter-status')).toContainText('label is Housing');
  await expect(unmapped.locator('.tile-filter-status')).toContainText('No matching field');
  await expect(unmapped.locator('.tile-filter-status')).toContainText('label');

  await target.locator('.tile-settings summary').click();
  await target.getByLabel('Incoming cross-filter behavior').selectOption('highlight');
  await expect(target.locator('.tile-filter-status')).toContainText('Highlighting');
  await target.getByLabel('Incoming cross-filter behavior').selectOption('none');
  await expect(target.locator('.tile-filter-status')).toContainText('ignored');
});

test('selected-mark table announces its source chart, field, and selected value', async ({ page }) => {
  await ready(page);
  await importJSON(page, envelope([tile('source', 'bar', 'categorical', 0)]));
  const source = page.locator('.grid-stack-item[gs-id="source"]');
  await source.locator('.tile-chart svg [aria-label^="Category: Housing"]').click();
  await expect(source.locator('.chart-drillthrough summary')).toContainText('Inspect selected records');
  await expect(source.locator('.chart-drillthrough summary')).toContainText('Source');
  await expect(source.locator('.chart-drillthrough summary')).toContainText('label is Housing');
});
