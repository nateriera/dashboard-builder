import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { shareHtml } from './header-actions.js';

// Donut fit: in a tile that is clearly wider than it is tall the legend sits
// beside the ring and the ring takes the tile's height; square and tall tiles
// keep the stacked layout. Each layout is seeded through the app's own
// autosave key, so nothing here depends on the default dashboard.
const KEY = 'dashboard-builder:layout:v1';
const tile = (id, type, x, y, w, h) => ({ id, type, title: id, source: '', dataset: 'categorical', binding: { mode: 'explicit', ref: 'categorical' }, sizing: 'manual', tileOptions: {}, x, y, w, h });
const envelope = tiles => ({ app: 'dashboard-builder', version: 3, rowHeight: 24, theme: 'paper', defaultDataset: { kind: 'samples' }, tiles });

async function open(page, layout) {
  await page.addInitScript(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, [KEY, JSON.stringify(layout)]);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Layout restored from this browser');
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.db-donut svg').first()).toBeVisible();
}

// Geometry of one donut tile, measured from the rendered page.
const geometry = scope => scope.evaluate(el => {
  const chart = el.querySelector('.tile-chart') || el;
  const svg = el.querySelector('.db-donut svg'), legend = el.querySelector('.db-legend');
  const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const s = box(svg), l = box(legend), t = box(el);
  const extras = [...chart.children].filter(node => !node.classList.contains('db-card')).reduce((sum, node) => { const css = getComputedStyle(node); return sum + node.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom); }, 0);
  const viewBox = svg.viewBox.baseVal.width;
  return {
    side: el.querySelector('.db-donut').classList.contains('db-donut-side'),
    svg: s, legend: l, tile: t, extras,
    contentHeight: chart.clientHeight, overflow: chart.scrollHeight - chart.clientHeight,
    ringDiameter: s.width * 300 / viewBox,
    totalPx: parseFloat(svg.querySelector('text').getAttribute('font-size')) * s.width / viewBox,
    items: [...legend.querySelectorAll('.db-legend-item')].map(item => { const label = box(item.querySelector('.db-legend-label')), fig = box(item.querySelector('.db-fig')); return { text: item.textContent, label, fig, overlap: !(label.right <= fig.left + 0.5 || fig.right <= label.left + 0.5 || label.bottom <= fig.top + 0.5 || fig.bottom <= label.top + 0.5) }; })
  };
});

test('donut fit: a wide tile puts the legend beside a ring sized to the tile height, and slices still cross-filter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, envelope([tile('wide-donut', 'donut', 0, 0, 7, 16), tile('target-bar', 'bar', 7, 0, 5, 16)]));
  const donut = page.locator('.grid-stack-item[gs-id="wide-donut"]');
  const g = await geometry(donut);
  expect(g.side).toBe(true);
  expect(g.legend.left).toBeGreaterThanOrEqual(g.svg.right);            // legend to the right, not under
  expect(g.legend.right).toBeLessThanOrEqual(g.tile.right);
  expect(g.legend.top).toBeGreaterThanOrEqual(g.svg.top - 1);
  expect(g.legend.bottom).toBeLessThanOrEqual(g.svg.bottom + 1);        // vertically within the ring's span
  // The ring uses the height the tile has left after its note and data row
  // (32px of card padding and a few px of rounding are the only slack).
  expect(g.svg.height).toBeGreaterThanOrEqual(g.contentHeight - g.extras - 32 - 14);
  expect(g.overflow).toBeLessThanOrEqual(1);                            // and nothing is pushed out of the tile
  expect(g.items).toHaveLength(6);                                      // five largest + Other
  expect(g.items.every(item => !item.overlap)).toBe(true);
  expect(g.totalPx).toBeGreaterThanOrEqual(12);
  await expect(donut.locator('.db-donut')).toContainText('48,240');
  // Cross-filter from a slice in the side-by-side layout.
  const target = page.locator('.grid-stack-item[gs-id="target-bar"]');
  await expect(target.locator('.chart-data summary')).toContainText('(8 rows)');
  await donut.locator('.tile-chart svg a[href^="#db-crossfilter:"]').first().click();
  await expect(target.locator('.chart-data summary')).toContainText('(1 rows)');
  await expect(target.locator('.tile-filter-status')).toHaveAttribute('data-state', 'filtered');
  // The centre labels still pass pointer events to the page beneath them.
  expect(await donut.locator('.db-donut svg text').evaluateAll(nodes => nodes.every(node => node.getAttribute('pointer-events') === 'none'))).toBe(true);
});

test('donut fit: square and tall tiles keep the stacked layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, envelope([tile('square-donut', 'donut', 0, 0, 4, 20), tile('tall-donut', 'donut', 4, 0, 3, 26)]));
  for (const id of ['square-donut', 'tall-donut']) {
    const g = await geometry(page.locator(`.grid-stack-item[gs-id="${id}"]`));
    expect(g.side, id).toBe(false);
    expect(g.legend.top, id).toBeGreaterThanOrEqual(g.svg.bottom);       // legend under the ring
    expect(g.svg.width, id).toBeLessThanOrEqual(400);
    expect(g.items.every(item => !item.overlap), id).toBe(true);
  }
});

test('donut fit: a wide donut fills its tile in present mode, and the exported file keeps the fit at desktop and phone widths', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The proportions of a two-up band: a line beside a donut, 16 rows tall.
  await open(page, envelope([{ ...tile('trend', 'line', 0, 0, 7, 16), dataset: 'timeseries', binding: { mode: 'explicit', ref: 'timeseries' } }, tile('wide-donut', 'donut', 7, 0, 5, 16)]));
  await page.locator('#btn-present').click();
  await expect(page.locator('#btn-exit-present')).toBeVisible();
  const donut = page.locator('.grid-stack-item[gs-id="wide-donut"]');
  await expect.poll(async () => (await geometry(donut)).side).toBe(true);
  const g = await geometry(donut);
  // The ring is at least 60% of the tile's content height (it was about a third when stacked).
  expect(g.ringDiameter / g.contentHeight).toBeGreaterThanOrEqual(0.6);
  expect(g.overflow).toBeLessThanOrEqual(1);
  await expect(donut.locator('.db-donut')).toContainText('48,240');
  await page.locator('#btn-exit-present').click();

  // The exported viewer renders through the same code.
  page.on('dialog', dialog => dialog.accept());
  const pending = page.waitForEvent('download');
  await shareHtml(page);
  const html = await fs.readFile(await (await pending).path(), 'utf8');
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 1440, height: 900 });
  await viewer.setContent(html);
  const exported = viewer.locator('.export-tile', { has: viewer.locator('.db-donut') });
  await expect(exported.locator('.db-donut svg')).toBeVisible();
  const desktop = await geometry(exported);
  expect(desktop.side).toBe(true);
  expect(desktop.legend.left).toBeGreaterThanOrEqual(desktop.svg.right);
  expect(desktop.legend.right).toBeLessThanOrEqual(desktop.tile.right);
  expect(desktop.items.every(item => !item.overlap)).toBe(true);
  // At phone width the tile is about 130px wide: stacked, every label and figure readable.
  await viewer.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await geometry(exported)).side).toBe(false);
  const phone = await geometry(exported);
  expect(phone.items).toHaveLength(6);
  expect(phone.items.every(item => !item.overlap)).toBe(true);
  expect(phone.items.every(item => item.label.left >= phone.tile.left && item.label.right <= phone.tile.right + 0.5 && item.fig.right <= phone.tile.right + 0.5)).toBe(true);
  expect(phone.legend.top).toBeGreaterThanOrEqual(phone.svg.bottom);
  expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
