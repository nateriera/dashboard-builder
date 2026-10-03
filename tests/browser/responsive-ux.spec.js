import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = 'docs/diagnostics/mobile-ux-review-2026-10-02';
const viewports = [
  [320, 740],
  [375, 812],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900]
];

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await expect(page.locator('.tile')).toHaveCount(5);
  await expect(page.locator('[gs-id="import-1"] svg').first()).toBeVisible();
}

test('responsive canvas and visible action states at six review sizes', async ({ page }) => {
  await fs.mkdir(evidenceDir, { recursive: true });
  await ready(page);

  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    const viewport = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      appWidth: document.querySelector('#app-body').scrollWidth,
      gridWidth: document.querySelector('#grid-wrap').clientWidth,
      paletteVisibility: getComputedStyle(document.querySelector('#palette')).visibility,
      tileBounds: [...document.querySelectorAll('.grid-stack-item')].map(el => {
        const r = el.getBoundingClientRect();
        const chart = el.querySelector('.tile-chart');
        return {
          left: r.left,
          right: r.right,
          chartScrollHeight: chart?.scrollHeight ?? 0,
          chartClientHeight: chart?.clientHeight ?? 0,
          contentScrollHeight: el.querySelector('.grid-stack-item-content')?.scrollHeight ?? 0,
          contentClientHeight: el.querySelector('.grid-stack-item-content')?.clientHeight ?? 0
        };
      })
    }));
    expect(viewport.documentWidth).toBeLessThanOrEqual(width);
    expect(viewport.appWidth).toBeLessThanOrEqual(width);
    expect(viewport.tileBounds.every(({ left, right }) => left >= -1 && right <= width + 1)).toBe(true);
    if (width <= 700) {
      expect(viewport.paletteVisibility, JSON.stringify(viewport)).toBe('hidden');
      expect(viewport.gridWidth).toBeGreaterThan(width - 24);
      expect(viewport.tileBounds.every(tile => tile.chartScrollHeight <= tile.chartClientHeight + 1), JSON.stringify(viewport)).toBe(true);
      expect(viewport.tileBounds.every(tile => tile.contentScrollHeight <= tile.contentClientHeight + 1), JSON.stringify(viewport)).toBe(true);
    }
    if (width === 1280 || width === 1440) {
      const toolbarRows = await page.locator('.header-actions > button:visible').evaluateAll(buttons =>
        buttons.map(button => Math.round(button.getBoundingClientRect().top))
      );
      expect(new Set(toolbarRows).size).toBe(1);
    }
    await page.screenshot({
      path: path.join(evidenceDir, `${width}x${height}.png`),
      animations: 'disabled'
    });
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(180);
  await page.locator('#btn-charts').click();
  await expect(page.locator('#palette')).toHaveAttribute('aria-modal', 'true');
  await page.screenshot({ path: path.join(evidenceDir, '375x812-charts-open.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-charts')).toBeFocused();
  await page.locator('#btn-charts').click();
  await page.getByRole('button', { name: 'Close chart picker' }).click();
  await expect(page.locator('#btn-charts')).toBeFocused();

  await page.locator('#btn-more').click();
  await expect(page.locator('#btn-save')).toBeVisible();
  await expect(page.locator('#header-menu')).toHaveAttribute('aria-label', 'More dashboard actions');
  await page.screenshot({ path: path.join(evidenceDir, '375x812-more-open.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-more')).toBeFocused();

  await page.locator('#btn-data').click();
  const dashboardData = page.locator('.data-popover');
  await expect(dashboardData).toHaveAttribute('aria-label', 'Dashboard data');
  await expect(dashboardData.locator('.data-drop')).toContainText('Upload CSV or JSON');
  await expect(dashboardData.locator('.data-local-note')).toContainText('not sent to a server');
  expect(await dashboardData.locator('.data-drop').evaluate(el =>
    !!(el.compareDocumentPosition(el.parentElement.querySelector('.data-sql-note')) & Node.DOCUMENT_POSITION_FOLLOWING)
  )).toBe(true);
  await page.screenshot({ path: path.join(evidenceDir, '375x812-add-data-open.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-data')).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#btn-charts').click();
  expect(await page.locator('#palette').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.keyboard.press('Escape');
});

test('opening at phone width and saving preserves a saved desktop dashboard', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-more').click();
  await page.locator('#btn-save').click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles
    .map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((a, b) => a.id.localeCompare(b.id)));

  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();
  await ready(page);
  await page.locator('#btn-more').click();
  await page.locator('#btn-save').click();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles
    .map(({ id, x, y, w, h }) => ({ id, x, y, w, h })).sort((a, b) => a.id.localeCompare(b.id)));
  expect(after).toEqual(before);
});

test('phone authoring is touch-sized, adds a chart, and does not rewrite saved desktop geometry', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-more').click();
  await page.locator('#btn-save').click();
  await expect(page.locator('#status')).toContainText('Saved');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));

  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(650);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
  expect(after).toEqual(before);

  const actionButtons = page.locator('.header-actions > button:visible');
  for (let i = 0; i < await actionButtons.count(); i++) {
    const rect = await actionButtons.nth(i).boundingBox();
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator('#btn-charts').click();
  const bar = page.locator('#palette-items [data-tile-type="bar"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('type', 'button');
  await bar.click();
  await expect(page.locator('.tile')).toHaveCount(6);
  await expect(page.locator('#btn-charts')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.tile-title').last()).toBeFocused();

  await page.locator('#btn-more').click();
  await page.locator('#btn-save').click();
  await expect(page.locator('#status')).toContainText('Saved');
  const phoneSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
  expect(phoneSaved.filter(tile => before.some(original => original.id === tile.id)).sort((a, b) => a.id.localeCompare(b.id)))
    .toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
  const desktopBottom = Math.max(...before.map(tile => tile.y + tile.h));
  const phoneAdded = phoneSaved.find(tile => !before.some(original => original.id === tile.id));
  expect(phoneAdded.x).toBe(0);
  expect(phoneAdded.w).toBeGreaterThan(1);
  expect(phoneAdded.y).toBeGreaterThanOrEqual(desktopBottom);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(6);
  expect((await page.locator(`[gs-id="${phoneAdded.id}"]`).boundingBox()).width).toBeGreaterThan(200);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(300);

  const chartActions = await page.locator('.tile-toolbar button, .tile-toolbar summary').evaluateAll(items =>
    items.filter(el => el.getClientRects().length).map(el => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), h: el.getBoundingClientRect().height }))
  );
  expect(chartActions.every(action => action.h >= 44), JSON.stringify(chartActions)).toBe(true);
  await page.locator('.tile-settings summary').first().click();
  const fitButton = page.locator('.tile-settings-body button').first();
  await expect(fitButton).toBeVisible();
  expect((await fitButton.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.locator('.tile-settings summary').first().click();

  await page.locator('.tile-data-btn').first().click();
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  const sqlPopover = page.locator('.data-popover');
  await expect.poll(() => sqlPopover.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  await page.keyboard.press('Escape');

  const addedTile = page.locator(`[gs-id="${phoneAdded.id}"] .tile`);
  const title = addedTile.locator('.tile-title');
  await title.fill('Phone chart');
  await title.press('Tab');
  await expect(title).toHaveValue('Phone chart');
  await addedTile.locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'Categories (8)', exact: true }).click();
  await expect(addedTile.locator('.tile-data-label')).toHaveText('Categories (8)');
  const chartData = addedTile.locator('.chart-data');
  await chartData.locator('summary').click();
  await expect(chartData.locator('table tbody tr')).toHaveCount(8);
  const tableGeometry = await addedTile.evaluate(el => {
    const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    const table = el.querySelector('.chart-data table');
    const row = el.querySelector('.chart-data tbody tr:last-child');
    return { tile: rect(el), chart: rect(el.querySelector('.tile-chart')), table: rect(table), lastRow: rect(row), open: el.querySelector('.chart-data').open, text: row.innerText, color: getComputedStyle(row).color, background: getComputedStyle(row).backgroundColor };
  });
  expect(tableGeometry.lastRow.height, JSON.stringify(tableGeometry)).toBeGreaterThan(0);
  expect(tableGeometry.lastRow.bottom, JSON.stringify(tableGeometry)).toBeLessThanOrEqual(tableGeometry.tile.bottom + 1);
  const tableNavTargets = await chartData.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(tableNavTargets.every(height => height >= 44), JSON.stringify(tableNavTargets)).toBe(true);
  await chartData.screenshot({ path: path.join(evidenceDir, 'phone-chart-data-open.png'), animations: 'disabled' });
  await chartData.locator('summary').click();

  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  expect((await htmlDownload).suggestedFilename()).toMatch(/\.html$/);
  await addedTile.locator('.tile-remove').click();
  await expect(page.locator('.tile')).toHaveCount(5);
});
