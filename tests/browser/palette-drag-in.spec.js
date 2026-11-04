import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'dashboard-builder:layout:v1';
const TYPE = 'column';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

// The starter fills every row, so free the full-width top tile to leave an
// empty, visible region; then clear the saved layout so the only autosave we
// can observe is the one the drop schedules.
async function openEmptyRegion(page) {
  const top = page.locator('.grid-stack > .grid-stack-item[gs-y="0"]');
  await expect(top).toHaveCount(1);
  await top.locator('.tile-remove').click();
  await top.locator('.tile-remove-confirm .tpl-confirm-yes').click();
  await expect(page.locator('.grid-stack > .grid-stack-item[gs-y="0"]')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Changes saved in this browser');
  await expect.poll(() => savedTilesOfType(page)).not.toBeNull();
  const before = { saved: (await savedTilesOfType(page)).length, dom: await page.locator('.grid-stack > .grid-stack-item').count() };
  await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);
  return before;
}

async function savedTilesOfType(page) {
  return page.evaluate(([key, type]) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw).tiles.filter(t => t.type === type).map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h }));
  }, [STORAGE_KEY, TYPE]);
}

// GridStack positions the dragged clone by its top-left (pointer minus grab
// offset), so aim the pointer so the clone's corner sits just inside cell 0,0.
async function dragFrom(page, from) {
  const grid = await page.locator('.grid-stack').boundingBox();
  const card = await page.locator(`.palette-item[data-tile-type="${TYPE}"]`).boundingBox();
  const target = { x: grid.x + (from.x - card.x) + 6, y: grid.y + (from.y - card.y) + 4 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 20 });
  await page.mouse.move(target.x + 2, target.y + 2, { steps: 2 });
  await page.mouse.up();
}

async function expectDroppedTile(page, before) {
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(before.dom + 1);
  // Landed in the freed top region and is a fully wired tile (toolbar + chart).
  const dropped = page.locator('.grid-stack > .grid-stack-item[gs-y="0"]');
  await expect(dropped).toHaveCount(1);
  await expect(dropped.locator('.tile-toolbar')).toBeVisible();
  await expect(dropped.locator('.tile-remove')).toBeVisible();
  await expect(dropped.locator('.tile-chart svg').first()).toBeVisible();
  // No raw palette clone left behind in the grid or on the body.
  await expect(page.locator('.grid-stack .palette-item, body > .palette-item')).toHaveCount(0);
  // Autosaved app state: one more tile of the dragged type, at the drop cell.
  await expect.poll(() => savedTilesOfType(page)).not.toBeNull();
  const saved = await savedTilesOfType(page);
  expect(saved).toHaveLength(before.saved + 1);
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ x: 0, y: 0 })]));
}

test('palette drag-in from the label text lands a wired, autosaved tile', async ({ page }) => {
  await ready(page);
  const before = await openEmptyRegion(page);
  const label = await page.locator(`.palette-item[data-tile-type="${TYPE}"] .palette-item-label`).boundingBox();
  await dragFrom(page, { x: label.x + label.width / 2, y: label.y + label.height / 2 });
  await expectDroppedTile(page, before);
});

test('palette drag-in from the card edge lands a wired, autosaved tile', async ({ page }) => {
  await ready(page);
  const before = await openEmptyRegion(page);
  const card = await page.locator(`.palette-item[data-tile-type="${TYPE}"]`).boundingBox();
  const hit = { x: card.x + 3, y: card.y + 3 };
  // Precondition: the grab point is the card itself, not its label/desc text.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, hit)).toBe('palette-item');
  await dragFrom(page, hit);
  await expectDroppedTile(page, before);
});
