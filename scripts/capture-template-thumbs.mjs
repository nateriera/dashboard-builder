// Captures the built-in template thumbnails and the screenshot-at-load sheet.
//
// Usage:
//   node scripts/capture-template-thumbs.mjs [--sheet DIR] [--appendix] [--no-thumbs]
//
// Starts the vite dev server on 127.0.0.1:4178 (or uses BASE_URL), then, for
// each built-in template in gallery order, opens a fresh browser context with
// empty storage, applies the template from the gallery exactly as a user
// would (Use template → Replace) and:
//   • writes src/assets/template-thumbs/<id>.png — the present-mode 1440×900
//     screen rendered at 1160px wide (device scale 1160/1440 → 1160×725; the
//     gallery shows it 156px tall, object-fit: cover, anchored top);
//   • with --sheet DIR, writes DIR/<nn>-<id>.png — the dashboard as presented:
//     present mode in a 1440×900 viewport, the review surface (PR #42, B6).
//     Fails if any dashboard scrolls in present mode: everything must be
//     visible at once. --appendix also writes DIR/appendix/<nn>-<id>.png, the
//     whole page in edit mode (supporting material, not the review surface);
//   • fails if the page logs any console error or page error at load.
// The starter dashboard is captured to the sheet as 00-starter.png.
// Drives installed Google Chrome through Playwright, like the browser suite.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sheetIdx = args.indexOf('--sheet');
const SHEET = sheetIdx >= 0 ? resolve(args[sheetIdx + 1]) : null;
const THUMBS = !args.includes('--no-thumbs');
const APPENDIX = args.includes('--appendix');
const PORT = 4178;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const THUMB = { width: 1440, height: 900, scale: 1160 / 1440 };

async function startServer() {
  if (process.env.BASE_URL) return null;
  const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--configLoader', 'runner', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(BASE)).ok) return server; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  server.kill();
  throw new Error(`vite did not start on ${BASE}`);
}

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.scale ?? 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => localStorage.setItem('dashboard-builder:palette-guidance-dismissed:v1', '1'));
  await page.goto(BASE);
  await page.locator('#status').filter({ hasText: /Starter dashboard loaded/ }).waitFor({ timeout: 30000 });
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
  return { context, page, errors };
}

async function settle(page) {
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.tile')];
    return tiles.length > 0 && tiles.every(t => t.querySelector('svg, .db-kpi-value, .db-data-table, .db-annotation, .tile-error'));
  }, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

async function applyTemplate(page, name) {
  const action = page.locator('#btn-templates');
  if (!(await action.isVisible())) await page.locator('.header-more > summary').click();
  await action.click();
  await page.evaluate(() => { const more = document.querySelector('.header-more'); if (more) more.open = false; });
  const card = page.locator('.tpl-card').filter({ has: page.getByText(name, { exact: true }) });
  await card.getByRole('button', { name: 'Use template' }).click();
  await card.getByRole('button', { name: 'Replace' }).click();
  await page.locator('.tpl-modal').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await page.locator('#status').filter({ hasText: `Applied template “${name}”.` }).waitFor({ timeout: 10000 });
}

async function presentShot(page, file, label) {
  // Present mode at 1440×900, exactly as a presentation shows it; no page scroll allowed.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.getElementById('btn-present').click());
  await page.locator('#btn-exit-present').waitFor({ state: 'visible' });
  await settle(page);
  const fit = await page.evaluate(() => {
    const wrap = document.getElementById('grid-wrap');
    const bottom = Math.max(...[...document.querySelectorAll('.grid-stack-item')].map(t => t.getBoundingClientRect().bottom));
    return { scroll: wrap.scrollHeight - wrap.clientHeight, page: document.documentElement.scrollHeight - innerHeight, bottom: Math.round(bottom) };
  });
  if (fit.scroll > 1 || fit.page > 1 || fit.bottom > 900) failures.push(`${label}: does not fit 1440×900 in present mode (grid bottom ${fit.bottom}px)`);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file });
  await page.evaluate(() => document.getElementById('btn-exit-present').click());
}

async function sheetShot(page, file) {
  // Appendix: grow the viewport until the whole grid is on screen, then capture it.
  const height = await page.evaluate(() => {
    const grid = document.querySelector('.grid-stack');
    const top = grid.getBoundingClientRect().top + window.scrollY;
    return Math.ceil(top + grid.scrollHeight + 48);
  });
  await page.setViewportSize({ width: 1440, height: Math.max(900, height) });
  await settle(page);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: file });
}

const failures = [];
const server = await startServer();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const { BUILT_IN_TEMPLATES } = await import('../src/templates.js').catch(() => ({ BUILT_IN_TEMPLATES: null }));
  const list = BUILT_IN_TEMPLATES || await (async () => {
    const { page, context } = await open(browser, THUMB);
    const names = await page.evaluate(async () => (await import('/src/templates.js')).BUILT_IN_TEMPLATES.map(t => ({ id: t.id, name: t.name })));
    await context.close();
    return names;
  })();
  if (SHEET) {
    await mkdir(SHEET, { recursive: true });
    if (APPENDIX) await mkdir(join(SHEET, 'appendix'), { recursive: true });
    const { context, page, errors } = await open(browser, { width: 1440, height: 900 });
    await settle(page);
    await presentShot(page, join(SHEET, '00-starter.png'), 'starter');
    if (APPENDIX) await sheetShot(page, join(SHEET, 'appendix', '00-starter.png'));
    if (errors.length) failures.push(`starter: ${errors.join(' | ')}`);
    await context.close();
    console.log('sheet  00-starter.png');
  }
  for (const [i, tpl] of list.entries()) {
    if (THUMBS) {
      const { context, page, errors } = await open(browser, THUMB);
      await applyTemplate(page, tpl.name);
      await settle(page);
      await presentShot(page, join(root, 'src', 'assets', 'template-thumbs', `${tpl.id}.png`), `${tpl.id} (thumb)`);
      if (errors.length) failures.push(`${tpl.id} (thumb): ${errors.join(' | ')}`);
      await context.close();
      console.log('thumb ', `${tpl.id}.png`);
    }
    if (SHEET) {
      const { context, page, errors } = await open(browser, { width: 1440, height: 900 });
      await applyTemplate(page, tpl.name);
      await settle(page);
      const tileErrors = await page.locator('.tile-error').allTextContents();
      if (tileErrors.length) failures.push(`${tpl.id}: tile errors: ${tileErrors.join(' | ')}`);
      const file = `${String(i + 1).padStart(2, '0')}-${tpl.id}.png`;
      await presentShot(page, join(SHEET, file), tpl.id);
      if (APPENDIX) await sheetShot(page, join(SHEET, 'appendix', file));
      if (errors.length) failures.push(`${tpl.id} (sheet): ${errors.join(' | ')}`);
      await context.close();
      console.log('sheet ', file);
    }
  }
} finally {
  await browser.close();
  server?.kill();
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('zero console errors at load');
