// Capture genuine local browser interactions for the README demo GIF; encode
// the frames with scripts/encode-demo.py.
//
// Usage (after `npm run build`):
//   node scripts/capture-demo.mjs && python3 scripts/encode-demo.py
//
// Serves the production build with `vite preview` on 127.0.0.1:4175 and
// drives installed Google Chrome at 1440×900. Sequence on the Meridian County
// starter: drag the household-type bar chart, resize it, change a typed
// (multi-select) parameter bound to a dashboard filter on it, brush the
// 311 daily time series, then Share as HTML and open the offline
// viewer. Built-in synthetic sample data only.
//
// Full-resolution takes for the launch video are kept alongside the frames:
// every frame is a 2880×1800 (2×) PNG in output/readme-polish/frames. With
// DEMO_VIDEO=1 Playwright also records the session to output/readme-polish/video
// (needs `npx playwright install ffmpeg`).
// output/ is scratch space and is not committed.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const out = 'output/readme-polish';
const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_KEY = 'dashboard-builder:layout:v1';
const VIEWPORT = { width: 1440, height: 900 };
const LABELS = ['Single adults', 'Families', 'Youth 18–24', 'Veterans', 'Not recorded'];
const BAR = 'Single adults are half';
const LINE = '311: closures trail openings'; // daily area chart: the brushed time series
const META = { title: 'Meridian County services at a glance', by: 'Dashboard Builder sample', period: 'October 2023 – October 2026' };

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/frames`, { recursive: true });

// node + vite.js rather than `npx`, which spawn cannot resolve on Windows.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
  if (i > 100) { server.kill(); throw Error(`vite preview did not start on ${BASE}; run npm run build first`); }
  await new Promise(r => setTimeout(r, 200));
}

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: VIEWPORT, deviceScaleFactor: 2, acceptDownloads: true,
  // Video needs Playwright's ffmpeg (`npx playwright install ffmpeg`), so it is opt-in.
  ...(process.env.DEMO_VIDEO ? { recordVideo: { dir: `${out}/video`, size: VIEWPORT } } : {})
});
const page = await context.newPage();
page.on('dialog', d => d.accept());
let index = 0;
const frames = [];
async function shot(duration = 500) {
  const path = `${out}/frames/${String(index++).padStart(4, '0')}.png`;
  await page.screenshot({ path }); frames.push({ path, duration });
}
const node = tile => tile.evaluate(e => ({ x: e.gridstackNode.x, y: e.gridstackNode.y, w: e.gridstackNode.w, h: e.gridstackNode.h }));

try {
  // Starter dashboard plus one typed parameter: a multi-select bound to a
  // chart-scoped household-type filter on the bar chart.
  await page.goto(BASE);
  await page.locator('#status').filter({ hasText: /Starter dashboard loaded/ }).waitFor();
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
  await page.locator('.header-more > summary').click();
  const jsonDownload = page.waitForEvent('download');
  await page.locator('#btn-export').click();
  const layout = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8'));
  delete layout.omittedDependencies;
  const targets = layout.tiles.filter(t => t.dataset === 'flowByGroup').map(t => ({ tileId: t.id, field: 'label' }));
  if (targets.length !== 1) throw Error(`Expected one flowByGroup tile on the starter, found ${targets.length}`);
  layout.filters = [{ id: 'filter-households', field: 'label', op: 'is', values: [...LABELS], scope: 'charts', targets }];
  layout.parameters = [{ name: 'households', type: 'multi-select', value: [...LABELS], source: { dataset: 'flowByGroup', column: 'label' }, options: [...LABELS], bindings: [{ kind: 'filter', filterId: 'filter-households' }] }];
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LAYOUT_KEY, JSON.stringify(layout)]);
  await page.reload();
  await page.locator('#status').filter({ hasText: /Layout restored from this browser/ }).waitFor();
  // Tile titles are editable inputs, so match on the input's value.
  const ids = await page.evaluate(titles => titles.map(t => [...document.querySelectorAll('.grid-stack-item')]
    .find(el => [...el.querySelectorAll('input')].some(i => i.value === t))?.getAttribute('gs-id')), [BAR, LINE]);
  if (ids.some(id => !id)) throw Error(`Starter tiles not found by title: ${JSON.stringify(ids)}`);
  const tileByTitle = title => page.locator(`[gs-id="${ids[[BAR, LINE].indexOf(title)]}"]`);
  await tileByTitle(BAR).locator('svg').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await shot(1800);

  // 1. Drag the bar chart by its toolbar one column right; it swaps with the
  //    dot plot.
  const tile = tileByTitle(BAR);
  const before = await node(tile);
  const handle = await tile.locator('.tile-toolbar').boundingBox();
  const hx = handle.x + 24, hy = handle.y + handle.height / 2;
  await page.mouse.move(hx, hy); await page.mouse.down();
  const grid = await page.locator('.grid-stack').boundingBox();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(hx + (grid.width * 0.27) * i / 12, hy); await shot(80); }
  await page.mouse.up(); await page.waitForTimeout(500); await shot(1200);
  const moved = await node(tile);
  if (moved.x !== 9 || moved.y !== before.y) throw Error(`Drag did not land on column 9: ${JSON.stringify(moved)}`);

  // 2. Resize from the bottom-left corner to double the bar chart's width; the
  //    dot plot moves down (no vertical drag, so the grid never auto-scrolls).
  await tile.hover();
  const resize = await tile.locator('.ui-resizable-sw').boundingBox();
  const rx = resize.x + resize.width / 2, ry = resize.y + resize.height / 2;
  await page.mouse.move(rx, ry); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(rx - (grid.width * 0.26) * i / 10, ry); await shot(80); }
  await page.mouse.up(); await page.waitForTimeout(600); await shot(1400);
  const after = await node(tile);
  if (after.x !== 6 || after.w !== 6 || after.h !== moved.h) throw Error(`Resize did not reach columns 6–11: ${JSON.stringify(after)}`);

  // 3. Change the typed parameter; its bound filter narrows the bar chart.
  await page.locator('#btn-filters').click();
  const filters = page.locator('.dashboard-filters-popover');
  await filters.getByRole('tab', { name: 'Parameters' }).click();
  await shot(1400);
  const control = filters.getByLabel('Value for households');
  await control.selectOption(['Single adults', 'Families', 'Youth 18–24', 'Veterans']);
  await control.dispatchEvent('change');
  await page.waitForTimeout(600); await shot(1600);
  await page.locator('#btn-filters').click();
  await page.waitForTimeout(600); await shot(1600);
  const rows = await tile.locator('.chart-data summary').textContent();
  if (!/\(4 rows\)/.test(rows || '')) throw Error(`Parameter change did not narrow the bar chart: ${rows}`);

  // 4. Brush a date range on the time series.
  const line = tileByTitle(LINE);
  const svg = line.locator('.tile-chart svg[viewBox]:not([width="15"])').first();
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  const by = box.y + box.height * 0.45;
  await page.mouse.move(box.x + box.width * 0.3, by); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.width * (0.3 + 0.4 * i / 8), by); await shot(90); }
  if (!(await line.locator('.tile-chart svg .db-time-brush').count())) throw Error('Brush did not draw');
  await page.mouse.up(); await page.mouse.move(box.x + box.width * 0.5, box.y - 40);
  await page.waitForTimeout(600); await shot(1800);

  // 5. Share as HTML with metadata, then open the downloaded file offline.
  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await dialog.waitFor(); await shot(900);
  await dialog.getByLabel('Dashboard title', { exact: true }).fill(META.title);
  await dialog.getByLabel('Prepared by', { exact: true }).fill(META.by);
  await dialog.getByLabel('Data period', { exact: true }).fill(META.period);
  await shot(1600);
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  const download = await htmlDownload;
  await download.saveAs(`${out}/demo-export.html`);
  const html = await readFile(`${out}/demo-export.html`, 'utf8');
  await context.setOffline(true);
  await page.route('**/*', route => route.abort());
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('.export-tile svg').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await shot(3000);

  await writeFile(`${out}/capture.json`, JSON.stringify({ before, moved, after, export: download.suggestedFilename(), frames }, null, 2));
} finally {
  await context.close();
  await browser.close();
  server.kill();
}
console.log(`${frames.length} frames in ${out}/frames${process.env.DEMO_VIDEO ? `; video in ${out}/video` : ''}`);
