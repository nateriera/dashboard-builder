import { test, expect } from '@playwright/test';
import { seedLegacyStarter } from './legacy-starter.js';

// These specs drive the pre-exemplar starter (Headlines, Requests by category,
// Monthly requests, donut, scatter); seed it explicitly. Assertions unchanged.
test.beforeEach(async ({ page }) => { await seedLegacyStarter(page); });


const layoutKey = 'dashboard-builder:layout:v1';

// Every tile's geometry keyed by gs-id, read from GridStack's live nodes.
async function allGeometry(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.grid-stack-item')].map(el => {
      const { x, y, w, h } = el.gridstackNode;
      return [el.getAttribute('gs-id'), { x, y, w, h }];
    })
  ));
}

// Geometry as saved to local storage, keyed by tile id.
async function persistedGeometry(page) {
  return page.evaluate(key => {
    const layout = JSON.parse(localStorage.getItem(key) || 'null');
    return Object.fromEntries((layout?.tiles ?? []).map(t => [t.id, { x: t.x, y: t.y, w: t.w, h: t.h }]));
  }, layoutKey);
}

test('Escape restores every tile displaced during arrangement, before and after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const tiles = page.locator('.grid-stack-item');
  await expect(tiles).toHaveCount(5);

  // Entry snapshot: the layout Escape must return to exactly.
  const entry = await allGeometry(page);

  // Arrange the full-width Headlines tile and push it down into Requests by category.
  const headlines = page.locator('.grid-stack-item').filter({ has: page.getByRole('button', { name: 'Move and resize Headlines' }) });
  const headlinesId = await headlines.getAttribute('gs-id');
  await headlines.getByRole('button', { name: 'Move and resize Headlines' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  // Sanity: the move really displaced at least one neighbour, otherwise the test proves nothing.
  const during = await allGeometry(page);
  const displaced = Object.keys(entry).filter(id => id !== headlinesId && JSON.stringify(during[id]) !== JSON.stringify(entry[id]));
  expect(displaced.length).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toHaveText('Canceled arranging Headlines.');
  await expect.poll(async () => allGeometry(page)).toEqual(entry);
  await expect.poll(async () => persistedGeometry(page)).toEqual(entry);

  await page.reload();
  await expect(tiles).toHaveCount(5);
  await expect.poll(async () => allGeometry(page)).toEqual(entry);
});

test('Enter still commits the arranged and displaced geometry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const headlines = page.locator('.grid-stack-item').filter({ has: page.getByRole('button', { name: 'Move and resize Headlines' }) });
  const headlinesId = await headlines.getAttribute('gs-id');
  const entry = await allGeometry(page);
  await headlines.getByRole('button', { name: 'Move and resize Headlines' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const committed = await allGeometry(page);
  expect(committed[headlinesId].y).toBe(entry[headlinesId].y + 3);
  await expect.poll(async () => persistedGeometry(page)).toEqual(committed);
  await page.reload();
  await expect.poll(async () => allGeometry(page)).toEqual(committed);
});
