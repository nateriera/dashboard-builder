// Capture genuine local browser interactions for the README demo GIF; encode
// the frames with scripts/encode-demo.py.
//
// Usage (after `npm run build`):
//   node scripts/capture-demo.mjs && python3 scripts/encode-demo.py
//
// Serves the production build with `vite preview` on 127.0.0.1:4175 and
// drives installed Google Chrome at 1440×900. Sequence on the canonical demo,
// docs/examples/meridian-homeless-response.json (the Meridian County
// homeless-response dashboard): drag a donut in from the palette and resize
// it, brush January–June 2026 on the monthly count, move the extra_exits
// what-if parameter, then Share as HTML and open the offline viewer.
// Built-in synthetic sample data only.
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
const CANONICAL = 'docs/examples/meridian-homeless-response.json';
const COUNT = 'Peak 1,709 (Jan 2025); a second rise in early 2026'; // the brushed time series
const DONUT = 'Single adults are half of entries';
const WHATIF = 'What if more people moved into housing each month?';

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
  // The canonical dashboard with the donut's slot left empty, seeded through
  // the app's own autosave key.
  const layout = JSON.parse(await readFile(CANONICAL, 'utf8'));
  delete layout.omittedDependencies;
  layout.tiles = layout.tiles.filter(t => t.title !== DONUT);
  await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [LAYOUT_KEY, JSON.stringify(layout)]);
  await page.addInitScript(() => localStorage.setItem('dashboard-builder:palette-guidance-dismissed:v1', '1'));
  await page.goto(BASE);
  await page.locator('#status').filter({ hasText: /Layout restored from this browser/ }).waitFor();
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
  // Tile titles are editable inputs, so match on the input's value.
  const tileByTitle = async title => page.locator(`[gs-id="${await page.evaluate(t => [...document.querySelectorAll('.grid-stack-item')]
    .find(el => el.querySelector('.tile-title')?.value === t)?.getAttribute('gs-id'), title)}"]`);
  await (await tileByTitle(COUNT)).locator('svg').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await shot(1800);

  // 1. Drag a donut from the palette into the empty slot. It follows the
  //    dashboard's dataset, so it draws entries by household group.
  const grid = await page.locator('.grid-stack').boundingBox();
  const cell = grid.width / 12;
  const label = await page.locator('.palette-item[data-tile-type="donut"] .palette-item-label').boundingBox();
  const px = label.x + label.width / 2, py = label.y + label.height / 2;
  const tx = grid.x + cell * 7 + 70, ty = grid.y + 40, lane = grid.y - 50;
  await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 12, py + 4, { steps: 3 });
  for (let i = 1; i <= 5; i++) { await page.mouse.move(px + 12 + 40 * i / 5, py + (lane - py) * i / 5); await shot(80); }
  for (let i = 1; i <= 8; i++) { await page.mouse.move(px + 52 + (tx - px - 52) * i / 8, lane); await shot(80); }
  for (let i = 1; i <= 4; i++) { await page.mouse.move(tx, lane + (ty - lane) * i / 4); await shot(80); }
  await page.mouse.move(tx + 2, ty + 2); await page.waitForTimeout(200);
  await page.mouse.up(); await page.waitForTimeout(700); await shot(1200);
  const tile = await tileByTitle('Share of requests');
  const before = await node(tile);

  // 2. Resize it from the bottom-right corner to the canonical 5×16, then title it.
  await tile.hover();
  const resize = await tile.locator('.ui-resizable-se').boundingBox();
  const rx = resize.x + resize.width / 2, ry = resize.y + resize.height / 2;
  await page.mouse.move(rx, ry); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(rx + cell * (5 - before.w) * i / 10, ry - 24 * (before.h - 16) * i / 10); await shot(80); }
  await page.mouse.up(); await page.waitForTimeout(600);
  const moved = await node(tile);
  if (moved.x !== 7 || moved.y !== 0 || moved.w !== 5 || moved.h !== 16) throw Error(`Donut did not reach 7,0 5×16: ${JSON.stringify(moved)}`);
  await tile.locator('.tile-title').fill(DONUT);
  await tile.locator('.tile-title').press('Enter');
  await page.waitForTimeout(500); await shot(1600);
  const after = await node(await tileByTitle(DONUT));

  // 3. Brush January–June 2026 on the count; the other charts cross-filter.
  const line = await tileByTitle(COUNT);
  const svg = line.locator('.tile-chart svg[viewBox]:not([width="15"])').first();
  const box = await svg.boundingBox();
  const by = box.y + box.height * 0.42;
  await page.mouse.move(box.x + box.width * 0.758, by); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.width * (0.758 + 0.144 * i / 8), by); await shot(90); }
  if (!(await line.locator('.tile-chart svg .db-time-brush').count())) throw Error('Brush did not draw');
  await page.mouse.up(); await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 60);
  await page.waitForTimeout(700); await shot(2400);
  const filtered = await page.locator('.tile-filter-status').evaluateAll(els => els.map(e => [e.dataset.state, e.textContent]));
  if (filtered.length !== 3 || filtered.some(([state, text]) => state !== 'filtered' || !/2026-01-01 to 2026-06-01/.test(text))) throw Error(`Brush did not cross-filter January–June 2026: ${JSON.stringify(filtered)}`);
  const legend = (await (await tileByTitle(DONUT)).locator('.tile-chart').textContent()).replace(/\s+/g, ' ');
  if (!/Families\s*555/.test(legend)) throw Error(`Donut did not re-answer: ${legend}`);

  // 4. Clear the brush (reload restores the saved dashboard without it), then
  //    move the what-if parameter; its bound filter changes the projection.
  await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); saved.filters = saved.filters.filter(f => f.source !== 'crossfilter'); localStorage.setItem(key, JSON.stringify(saved)); }, LAYOUT_KEY);
  await page.reload();
  await page.locator('#status').filter({ hasText: /Layout restored from this browser/ }).waitFor();
  await (await tileByTitle(WHATIF)).locator('svg').first().waitFor();
  await page.waitForTimeout(600); await shot(1200);
  await page.locator('#btn-filters').click();
  const filters = page.locator('.dashboard-filters-popover');
  await filters.getByRole('tab', { name: 'Parameters' }).click();
  await shot(1400);
  for (const value of ['20', '40']) {
    await filters.getByLabel('Slider for extra_exits').fill(value);
    await filters.getByLabel('Slider for extra_exits').dispatchEvent('change');
    await page.waitForTimeout(700); await shot(1700);
  }
  const param = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).parameters[0].value, LAYOUT_KEY);
  if (param !== 40) throw Error(`Parameter did not reach 40: ${param}`);
  await page.locator('#btn-filters').click();
  await page.waitForTimeout(600); await shot(1500);

  // 5. Share as HTML (the dashboard carries its own title, preparer and
  //    period), then open the downloaded file offline.
  const htmlDownload = page.waitForEvent('download');
  await page.locator('#btn-export-html').click();
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await dialog.waitFor(); await shot(1600);
  if ((await dialog.getByLabel('Dashboard title', { exact: true }).inputValue()) !== 'Meridian County homeless response') throw Error('Share dialog did not prefill the dashboard title');
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
