import { test, expect } from '@playwright/test';

const layoutKey = 'dashboard-builder:layout:v1';

async function ready(page) {
  await page.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({
      app: 'dashboard-builder', version: 5, rowHeight: 24,
      defaultDataset: { kind: 'samples' }, filters: [], parameters: [], savedViews: [],
      tiles: [], pages: [{ id: 'page-1', name: 'Page 1' }], currentPageId: 'page-1', theme: 'slate'
    }));
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

async function persisted(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)).tiles[0], layoutKey);
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
  await expect.poll(async () => (await persisted(page)).x).toBe(initial.x);
  await expect.poll(async () => (await persisted(page)).y).toBe(initial.y);
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
  await expect.poll(async () => (await persisted(page)).w).toBe(before.w);
  await expect.poll(async () => (await persisted(page)).h).toBe(before.h);
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
  await expect.poll(async () => (await persisted(page)).x).toBe(initial.x + 1);
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
  await expect(status).toContainText(/Bar chart: row \d+, column \d+/);
});
