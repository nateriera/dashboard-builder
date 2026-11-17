import { test, expect } from '@playwright/test';
import { MERIDIAN_SERVICES_STARTER } from './meridian-services-starter.js';

// Launch-polish slice: a fresh profile (no saved state) opens on the Meridian
// County homeless-response dashboard, ready to brush and to ask what-if. A
// profile with saved state opens that state, exactly as before.
const KEY = 'dashboard-builder:layout:v1';

async function dismissHint(page) {
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
}
const byTitle = async (page, title) => page.locator(`.grid-stack-item[gs-id="${await page.evaluate(t => [...document.querySelectorAll('.grid-stack-item')].find(e => e.querySelector('.tile-title')?.value === t)?.getAttribute('gs-id'), title)}"]`);

test('fresh profile: opens the homeless-response dashboard with its what-if parameter, and a brush cross-filters the other charts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await dismissHint(page);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(5);
  await expect.poll(() => page.locator('.tile').evaluateAll(tiles => tiles.every(t => t.querySelector('svg, .db-annotation')))).toBe(true);
  await expect(page.locator('.tile-error')).toHaveCount(0);

  // The what-if parameter and its bound filter.
  await page.locator('#btn-filters').click();
  const popover = page.locator('.dashboard-filters-popover');
  await popover.getByRole('tab', { name: 'Parameters' }).click();
  await expect(popover.getByLabel('Slider for extra_exits')).toHaveValue('0');
  await page.locator('#btn-filters').click();

  // Brush January–June 2026 on the count line.
  const count = await byTitle(page, 'Peak 1,709 (Jan 2025); a second rise in early 2026');
  const svg = count.locator('.tile-chart svg[viewBox]:not([width="15"])').first();
  const box = await svg.boundingBox();
  const y = box.y + box.height * 0.42;
  await page.mouse.move(box.x + box.width * 0.758, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.902, y, { steps: 14 });
  await page.mouse.up();
  const notices = page.locator('.tile-filter-status');
  await expect(notices).toHaveCount(3);
  for (const state of await notices.evaluateAll(els => els.map(e => e.dataset.state))) expect(state).toBe('filtered');
  await expect(notices.first()).toContainText('date from 2026-01-01 to 2026-06-01');
  const donut = await byTitle(page, 'Single adults are half of entries');
  await expect(donut.locator('.db-donut')).toContainText('1,495');
  await expect(donut.locator('.db-donut')).toContainText('555');
});

test('fresh profile: Share as HTML opens with blank metadata (the default carries no author, title or period)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await dismissHint(page);
  await page.locator('#btn-export-html').click();
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog).toBeVisible();
  for (const label of ['Dashboard title', 'Prepared by', 'Data period']) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
});

test('saved profile: a stored layout opens exactly as stored, not the new default', async ({ page }) => {
  await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [KEY, JSON.stringify(MERIDIAN_SERVICES_STARTER)]);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Layout restored from this browser');
  await dismissHint(page);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(6);
  const titles = await page.locator('.tile [aria-label="Tile title"]').evaluateAll(inputs => inputs.map(i => i.value));
  expect(titles[0]).toBe('Meridian County services: 311 timeliness below goal, homelessness edging down');
  await expect(page.locator('.db-kpi')).toHaveCount(4);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  expect(stored.parameters ?? []).toEqual([]);
  expect(stored.tiles.map(t => t.dataset ?? null)).toEqual(MERIDIAN_SERVICES_STARTER.tiles.map(t => t.dataset ?? null));
});
