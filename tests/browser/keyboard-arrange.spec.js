import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const layoutKey = 'dashboard-builder:layout:v1';

async function ready(page) {
  await page.addInitScript(key => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({
        app: 'dashboard-builder', version: 5, rowHeight: 24,
        defaultDataset: { kind: 'samples' }, filters: [], parameters: [], savedViews: [],
        tiles: [], pages: [{ id: 'page-1', name: 'Page 1' }], currentPageId: 'page-1', theme: 'slate'
      }));
    }
  }, layoutKey);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(1);
}

async function geometry(tile) {
  return tile.evaluate(el => {
    const { x, y, w, h } = el.gridstackNode;
    return { x, y, w, h };
  });
}

async function persisted(page, tile) {
  const id = await tile.getAttribute('gs-id');
  return page.evaluate(({ key, id }) => {
    const layout = JSON.parse(localStorage.getItem(key) || 'null');
    return layout?.tiles?.find(saved => saved.id === id) ?? null;
  }, { key: layoutKey, id });
}

test('keyboard arrangement moves one cell in every direction and persists after reload', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const initial = await geometry(tile);
  const button = tile.getByRole('button', { name: `Move and resize ${await tile.locator('.tile-title').inputValue()}` });
  await button.click();
  await expect(page.locator('#status')).toContainText('Arrow keys move, Shift + arrow keys resize');
  for (const [key, axis, delta] of [['ArrowRight', 'x', 1], ['ArrowDown', 'y', 1], ['ArrowLeft', 'x', -1], ['ArrowUp', 'y', -1]]) {
    const before = await geometry(tile);
    await page.keyboard.press(key);
    await expect.poll(async () => (await geometry(tile))[axis]).toBe(before[axis] + delta);
  }
  await page.keyboard.press('Enter');
  await expect(button).toBeFocused();
  await expect.poll(async () => (await persisted(page, tile))?.x).toBe(initial.x);
  await expect.poll(async () => (await persisted(page, tile))?.y).toBe(initial.y);
  const committed = await geometry(tile);
  await page.reload();
  await expect.poll(async () => geometry(page.locator('.grid-stack-item'))).toEqual(committed);
});

test('Shift plus arrows resizes by one cell, respects limits, and persists', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const button = tile.getByRole('button', { name: /Move and resize/ });
  await button.click();
  const before = await geometry(tile);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await geometry(tile)).w).toBe(before.w + 1);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await geometry(tile)).w).toBe(before.w);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await geometry(tile)).h).toBe(before.h + 1);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await geometry(tile)).h).toBe(before.h);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await persisted(page, tile))?.w).toBe(before.w);
  await expect.poll(async () => (await persisted(page, tile))?.h).toBe(before.h);
  await page.reload();
  await expect.poll(async () => geometry(tile)).toEqual(before);
});

test('Escape restores entry geometry; Enter commits keyboard changes', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const button = tile.getByRole('button', { name: /Move and resize/ });
  const initial = await geometry(tile);
  await button.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Escape');
  await expect.poll(async () => geometry(tile)).toEqual(initial);
  await expect(button).toBeFocused();
  await button.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await persisted(page, tile))?.x).toBe(initial.x + 1);
  await page.reload();
  await expect.poll(async () => (await geometry(tile)).x).toBe(initial.x + 1);
});

test('title editing keeps arrow keys in the text field and ends arrangement mode', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const title = tile.locator('.tile-title');
  const button = tile.getByRole('button', { name: /Move and resize/ });
  await button.click();
  await title.focus();
  await expect(tile).not.toHaveClass(/tile-arranging/);
  const before = await geometry(tile);
  await page.keyboard.press('ArrowRight');
  expect(await geometry(tile)).toEqual(before);
});

test('movement announcements use the polite status region and repeat bursts coalesce', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  await tile.getByRole('button', { name: /Move and resize/ }).click();
  const status = page.locator('#status');
  expect(await status.getAttribute('aria-live')).toBe('polite');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');
  await expect(status).toContainText(/Requests by category: row \d+, column \d+/);
  const announcement = await status.textContent();
  await page.waitForTimeout(650);
  await expect(status).toHaveText(announcement);
});

test('a minimum-size 1×1 tile persists explicit dimensions through reload', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const button = tile.getByRole('button', { name: /Move and resize/ });
  await button.click();
  let current = await geometry(tile);
  while (current.w > 1) {
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await geometry(tile)).w).toBe(current.w - 1);
    current = await geometry(tile);
  }
  while (current.h > 1) {
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(async () => (await geometry(tile)).h).toBe(current.h - 1);
    current = await geometry(tile);
  }
  await page.keyboard.press('Enter');
  await expect.poll(async () => {
    const saved = await persisted(page, tile);
    return saved && [saved.w, saved.h];
  }).toEqual([1, 1]);
  await page.reload();
  await expect.poll(async () => geometry(page.locator('.grid-stack-item'))).toMatchObject({ w: 1, h: 1 });
});

test('a Down move persists its open-space gap in the exported viewer', async ({ page }) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item');
  const button = tile.getByRole('button', { name: /Move and resize/ });
  const initial = await geometry(tile);
  await button.click();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await geometry(tile)).y).toBe(initial.y + 1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await persisted(page, tile))?.y).toBe(initial.y + 1);
  const id = await tile.getAttribute('gs-id');
  const downloading = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const download = await downloading;
  const html = await fs.readFile(await download.path(), 'utf8');
  const viewer = await page.context().newPage();
  await viewer.setContent(html);
  const exportedTile = viewer.locator(`.export-tile[data-tile-id="${id}"]`);
  await expect(exportedTile).toBeVisible();
  expect(await exportedTile.evaluate(el => getComputedStyle(el).gridRowStart)).toBe(String(initial.y + 2));
  const viewerGrid = viewer.locator('.export-grid:not([hidden])');
  const [gridTop, tileTop] = await Promise.all([
    viewerGrid.evaluate(el => el.getBoundingClientRect().top),
    exportedTile.evaluate(el => el.getBoundingClientRect().top)
  ]);
  const saved = await persisted(page, tile);
  expect(tileTop - gridTop).toBe(saved.y * 24 + 12);
  await viewer.close();
});

test('removing a tile leaves the placed neighbor in its saved row', async ({ page }) => {
  await ready(page);
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  const tiles = page.locator('.grid-stack-item');
  await expect(tiles).toHaveCount(2);
  const first = tiles.nth(0);
  const survivorId = await tiles.nth(1).getAttribute('gs-id');
  const survivor = page.locator(`.grid-stack-item[gs-id="${survivorId}"]`);
  const moveButton = survivor.getByRole('button', { name: /Move and resize/ });
  const start = await geometry(survivor);
  await moveButton.click();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await geometry(survivor)).y).toBe(start.y + 1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await persisted(page, survivor))?.y).toBe(start.y + 1);
  await first.locator('.tile-remove').click();
  await first.locator('.tile-remove-confirm .tpl-confirm-yes').click();
  await expect(tiles).toHaveCount(1);
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).tiles.length, layoutKey)).toBe(1);
  await expect.poll(async () => (await persisted(page, survivor))?.y).toBe(start.y + 1);
  await page.reload();
  await expect.poll(async () => geometry(page.locator('.grid-stack-item'))).toMatchObject({ y: start.y + 1 });
});
