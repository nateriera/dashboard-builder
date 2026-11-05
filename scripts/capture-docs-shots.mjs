// Captures the docs screenshots that no browser spec or `npm run shots`
// produces: one shot per built-in template (template-<id>.png, gallery
// order), the exported HTML viewer with real metadata and an active filter,
// and the typed-parameter viewer.
//
// Usage:
//   npm run build && node scripts/capture-docs-shots.mjs [templates]
//
// With `templates`, only the template shots are written.
//
// It serves the production build with `vite preview` on 127.0.0.1:4176,
// drives installed Google Chrome through Playwright (fresh context per shot,
// 1440×900 at 2× like `npm run shots`) and uses built-in sample data only.
// Layouts are seeded through the app's own autosave key, so they pass the
// app's validateLayout on load; exports go through Share as HTML and the
// downloaded file is opened with networking disabled.
//
// Do not run `npm run test:browser` afterwards in the same working tree
// before committing: prelaunch-fixes.spec.js rewrites html-sharing-viewer.png
// with its metadata-fallback version.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_KEY = 'dashboard-builder:layout:v1';
const VIEWPORT = { width: 1440, height: 900 };
const META = {
  'Dashboard title': 'Service requests overview',
  'Prepared by': 'Dashboard Builder sample',
  'Data period': 'January–December 2026'
};

async function startPreview() {
  const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE)).ok) return server; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  server.kill();
  throw new Error(`vite preview did not start on ${BASE}; run npm run build first`);
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page, errors };
}

async function ready(page, status = /Starter dashboard loaded|Layout restored from this browser/) {
  await page.locator('#status').filter({ hasText: status }).waitFor({ timeout: 30000 });
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
}

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.tile svg, .tile .db-kpi-value').length > 0, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
}

async function headerAction(page, selector) {
  const action = page.locator(selector);
  if (!(await action.isVisible())) await page.locator('.header-more > summary').click();
  await action.click();
}

async function closeMore(page) {
  await page.evaluate(() => { const more = document.querySelector('.header-more'); if (more) more.open = false; });
}

async function exportJson(page) {
  const download = page.waitForEvent('download');
  await headerAction(page, '#btn-export');
  await closeMore(page);
  return JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
}

async function shareHtml(page, meta) {
  const download = page.waitForEvent('download');
  await headerAction(page, '#btn-export-html');
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await dialog.waitFor();
  for (const [label, value] of Object.entries(meta)) await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  return fs.readFile(await (await download).path(), 'utf8');
}

// Capture-only: scroll the filter's multi-select so its first selected option
// sits at the top of the listbox, then require that at least one selected
// option is fully inside the box. Throws rather than writing a shot without it.
async function revealFilterSelection(viewer) {
  const lists = await viewer.locator('select[multiple]').count();
  if (lists !== 1) throw new Error(`html-sharing-viewer: expected one filter multi-select, found ${lists}`);
  await viewer.evaluate(() => {
    const sel = document.querySelector('select[multiple]');
    const first = [...sel.options].find(o => o.selected);
    if (!first) return;
    sel.scrollTop += first.getBoundingClientRect().top - sel.getBoundingClientRect().top;
  });
  const visible = await viewer.evaluate(() => {
    const sel = document.querySelector('select[multiple]');
    const box = sel.getBoundingClientRect();
    return [...sel.options]
      .filter(o => o.selected)
      .filter(o => { const r = o.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom; })
      .map(o => o.text);
  });
  if (!visible.length) throw new Error('html-sharing-viewer: no selected option is fully inside the filter listbox');
  console.log('selected options in frame:', visible.join(', '));
}

async function shootViewer(browser, html, out, prepare = null) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.setOffline(true);
  const viewer = await context.newPage();
  const errors = [];
  viewer.on('pageerror', e => errors.push(e.message));
  await viewer.route('**/*', route => route.abort());
  await viewer.setContent(html, { waitUntil: 'load' });
  await viewer.locator('.export-tile svg').first().waitFor({ timeout: 30000 });
  await viewer.evaluate(() => document.fonts.ready);
  await viewer.waitForTimeout(800);
  for (const text of ['Untitled dashboard', 'Not provided', 'Not specified']) {
    if (await viewer.getByText(text, { exact: false }).count()) throw new Error(`${out}: metadata fallback "${text}" is in frame`);
  }
  if (prepare) await prepare(viewer);
  await viewer.screenshot({ path: join(outDir, out) });
  await context.close();
  if (errors.length) throw new Error(`page errors on ${out}: ${errors.join(' | ')}`);
  console.log('wrote', out);
}

async function seedAndReload(page, layout) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LAYOUT_KEY, JSON.stringify(layout)]);
  await page.reload();
  await ready(page, /Layout restored from this browser/);
  await settle(page);
}

// ── Built-in templates, in gallery order (src/templates.js) ──────────────
const TEMPLATES = [
  ['homeless-system-performance', 'Homeless system performance (CoC)'],
  ['behavioral-health-quality', 'Behavioral health quality (CCBHC)'],
  ['health-center-quality', 'Health center quality (UDS)'],
  ['overdose-surveillance', 'Overdose & SUD community surveillance'],
  ['community-health-by-place', 'Community health by place'],
  ['program-outcomes', 'Program outcomes & funder report'],
  ['system-flow', 'System flow: inflow, outflow & actively homeless'],
  ['city-services-311', 'City services: 311 operations'],
  ['performance-scorecard', 'Performance scorecard (targets & thresholds)'],
  ['executive-overview', 'Executive overview'],
  ['sales-performance', 'Sales performance']
];

async function captureTemplate(browser, name, out) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(BASE);
  await ready(page);
  await headerAction(page, '#btn-templates');
  await closeMore(page);
  const card = page.locator('.tpl-card').filter({ has: page.getByText(name, { exact: true }) });
  await card.getByRole('button', { name: 'Use template' }).click();
  await card.getByRole('button', { name: 'Replace' }).click();
  await page.locator('.tpl-modal').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await settle(page);
  await page.mouse.move(0, VIEWPORT.height - 1);
  await page.screenshot({ path: join(outDir, out) });
  await context.close();
  if (errors.length) throw new Error(`page errors on ${out}: ${errors.join(' | ')}`);
  console.log('wrote', out);
}

// ── Exported viewer: starter dashboard, real metadata, one active filter ──
async function captureSharingViewer(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(BASE);
  await ready(page);
  await settle(page);
  const layout = await exportJson(page);
  delete layout.omittedDependencies;
  // Chart-scoped: the KPI sample also has a `label` column, so a
  // dashboard-wide label filter would empty the Headlines tile.
  const categoryTiles = layout.tiles.filter(t => t.dataset === 'categorical').map(t => ({ tileId: t.id, field: 'label' }));
  if (!categoryTiles.length) throw new Error('html-sharing-viewer: starter dashboard has no categorical tiles');
  layout.filters = [{ id: 'filter-category', field: 'label', op: 'is', values: ['Housing', 'Employment', 'Health', 'Food', 'Transport'], scope: 'charts', targets: categoryTiles }];
  await seedAndReload(page, layout);
  const html = await shareHtml(page, META);
  await context.close();
  if (errors.length) throw new Error(`page errors on html-sharing-viewer: ${errors.join(' | ')}`);
  await shootViewer(browser, html, 'html-sharing-viewer.png', revealFilterSelection);
}

// ── Exported viewer: typed parameters bound to dashboard filters ─────────
const tile = (id, type, title, dataset, x, y, w, h) => ({
  id, type, title, source: 'Sample data', dataset, binding: { mode: 'explicit', ref: dataset },
  sizing: 'manual', tileOptions: {}, drillValues: null, pageId: 'page-1', x, y, w, h
});

function parametersLayout() {
  return {
    app: 'dashboard-builder', version: 5, rowHeight: 24, theme: 'paper',
    meta: { title: META['Dashboard title'], preparedBy: META['Prepared by'], dataPeriod: META['Data period'] },
    defaultDataset: { kind: 'samples' },
    pages: [{ id: 'page-1', name: 'Page 1' }], currentPageId: 'page-1', savedViews: [],
    tiles: [
      tile('requests-line', 'line', 'Monthly requests by program', 'timeseries', 0, 0, 6, 16),
      tile('category-bar', 'bar', 'Requests by category', 'categorical', 6, 0, 6, 16),
      tile('region-stack', 'stackedColumn', 'Requests by region and client type', 'stacked', 0, 16, 12, 16)
    ],
    filters: [
      { id: 'filter-program', field: 'series', op: 'is', values: ['Housing'], scope: 'charts', targets: [{ tileId: 'requests-line', field: 'series' }] },
      { id: 'filter-volume', field: 'value', op: 'between', values: [3000, 13000], scope: 'charts', targets: [{ tileId: 'category-bar', field: 'value' }] },
      { id: 'filter-region', field: 'label', op: 'is', values: ['North', 'South', 'East', 'West', 'Central'], scope: 'charts', targets: [{ tileId: 'region-stack', field: 'label' }] }
    ],
    parameters: [
      { name: 'program', type: 'single-select', value: 'Housing', source: { dataset: 'timeseries', column: 'series' }, options: ['Housing', 'Employment'], bindings: [{ kind: 'filter', filterId: 'filter-program' }] },
      { name: 'volume', type: 'number-range', value: { from: 3000, to: 13000 }, bindings: [{ kind: 'filter', filterId: 'filter-volume' }] },
      { name: 'regions', type: 'multi-select', value: ['North', 'South', 'East', 'West', 'Central'], source: { dataset: 'stacked', column: 'label' }, options: ['North', 'South', 'East', 'West', 'Central', 'Metro', 'Coastal', 'Mountain'], bindings: [{ kind: 'filter', filterId: 'filter-region' }] }
    ]
  };
}

async function captureParametersViewer(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(BASE);
  await ready(page);
  await seedAndReload(page, parametersLayout());
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), LAYOUT_KEY);
  if ((restored.parameters || []).filter(p => p.bindings?.length).length !== 3) throw new Error('parameters-viewer: the app did not keep all three bound parameters');
  const html = await shareHtml(page, META);
  await context.close();
  if (errors.length) throw new Error(`page errors on parameters-viewer: ${errors.join(' | ')}`);
  await shootViewer(browser, html, 'parameters-viewer.png');
}

const server = await startPreview();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [id, name] of TEMPLATES) await captureTemplate(browser, name, `template-${id}.png`);
  if (process.argv[2] !== 'templates') {
    await captureSharingViewer(browser);
    await captureParametersViewer(browser);
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('done');
