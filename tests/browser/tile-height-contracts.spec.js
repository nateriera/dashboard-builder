import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { acceptImportConfirmation } from './accept-import.js';
import { clickHeaderAction } from './header-actions.js';

// S1 + S3 tile height contracts, measured at 1280×800 (the laptop viewport of
// the Nov 6 fit diagnosis): KPI cards stay inside their tile at 4, 5 and 6
// cards, and a note's required "Measures:" source line renders inside it.
test.use({ viewport: { width: 1280, height: 800 } });
acceptImportConfirmation(test);

const meridian = async name => JSON.parse(await fs.readFile(new URL(`../../src/data/meridian/${name}.json`, import.meta.url), 'utf8'));
const cycle = (rows, n) => Array.from({ length: n }, (_, i) => ({ ...rows[i % rows.length] }));
const columns = ['label', 'value', 'delta', 'deltaDir', 'invert'];
const kpiDataset = (name, rows) => ({ name, columns, fieldKeys: ['label', 'value', 'delta', 'deltaDir'], mapping: { label: 'label', value: 'value', delta: 'delta', deltaDir: 'deltaDir' }, rows });

// Everything a KPI tile paints (cards, their text, the "View data" line) must
// sit inside the tile's visible body, with no inner scroll and one card row.
async function kpiSpill(page, id) {
  return page.locator(`[gs-id="${id}"]`).evaluate(item => {
    const body = item.querySelector('.tile-chart');
    const box = body.getBoundingClientRect();
    const problems = [];
    if (body.scrollHeight > body.clientHeight + 1) problems.push(`inner vertical scroll ${body.scrollHeight - body.clientHeight}px`);
    if (body.scrollWidth > body.clientWidth + 1) problems.push(`inner horizontal scroll ${body.scrollWidth - body.clientWidth}px`);
    const cards = [...body.querySelectorAll('.db-kpi')];
    if (new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size !== 1) problems.push('cards wrapped to a second row');
    const painted = [...body.querySelectorAll('.db-kpi, .db-kpi *, details.chart-data > summary')];
    for (const el of painted) {
      const r = el.getBoundingClientRect();
      if (r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1)
        problems.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" crosses the tile by ${Math.round(Math.max(box.top - r.top, r.bottom - box.bottom, box.left - r.left, r.right - box.right))}px`);
    }
    return { cards: cards.length, problems };
  });
}

for (const n of [4, 5, 6]) {
  test(`S1: KPI tiles with ${n} cards keep every card and the View data line inside the tile at 1280×800, edit and present`, async ({ page }) => {
    const starter = (await meridian('starter')).starterKpis;
    const coc = (await meridian('coc')).cocKpis;
    // The starter's and the flagship's KPI rows at their template sizes (12×11, 12×12).
    const layout = {
      app: 'dashboard-builder', version: 3, rowHeight: 24,
      tiles: [
        { id: 'starter-kpis', type: 'kpi', title: 'Meridian County services: 311 timeliness below goal, homelessness edging down', dataset: 'upload:starterkpis', binding: { mode: 'explicit', ref: 'upload:starterkpis' }, x: 0, y: 0, w: 12, h: 11 },
        { id: 'flagship-kpis', type: 'kpi', title: 'FY2026: shorter stays and fewer returns; exits to housing still short of the 45% goal', dataset: 'upload:flagshipkpis', binding: { mode: 'explicit', ref: 'upload:flagshipkpis' }, x: 0, y: 11, w: 12, h: 12 }
      ],
      datasets: { starterkpis: kpiDataset('Starter KPIs', cycle(starter, n)), flagshipkpis: kpiDataset('Flagship KPIs', cycle(coc, n)) }
    };
    await page.goto('/');
    await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
    await page.locator('#file-import').setInputFiles({ name: `kpi-${n}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(layout)) });
    await expect(page.locator('#status')).toContainText('Imported');
    await expect(page.locator('[gs-id="starter-kpis"] .db-kpi')).toHaveCount(n);
    await expect(page.locator('[gs-id="flagship-kpis"] .db-kpi')).toHaveCount(n);
    await expect(page.locator('#palette')).toBeVisible(); // the real 1280 default: palette open

    for (const mode of ['edit', 'present']) {
      if (mode === 'present') { await clickHeaderAction(page, '#btn-present'); await expect(page.locator('body')).toHaveClass(/present/); }
      for (const id of ['starter-kpis', 'flagship-kpis']) {
        await expect.poll(async () => (await kpiSpill(page, id)).problems, { message: `${id}, ${mode}, ${n} cards` }).toEqual([]);
        await expect(page.locator(`[gs-id="${id}"] details.chart-data > summary`)).toBeVisible();
      }
    }
  });
}

// The note's last line is its required source line ("Measures: …"); measure
// where that line paints relative to the visible tile body.
async function noteFit(page) {
  return page.locator('.grid-stack-item:has(.db-annotation)').evaluate(item => {
    const body = item.querySelector('.tile-chart');
    const box = body.getBoundingClientRect();
    const node = [...item.querySelector('.db-annotation').childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.includes('Measures:'));
    const range = document.createRange();
    range.setStart(node, node.textContent.indexOf('Measures:')); range.setEnd(node, node.textContent.length);
    const lines = [...range.getClientRects()].filter(r => r.width > 0);
    return {
      lines: lines.length,
      sourceBottomOver: Math.round(Math.max(...lines.map(r => r.bottom)) - box.bottom),
      innerScroll: body.scrollHeight - body.clientHeight,
      scrollTop: body.scrollTop
    };
  });
}

test('S3: the starter note renders its "Measures:" source line inside the tile in present mode at 1280×800', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await clickHeaderAction(page, '#btn-present');
  await expect(page.locator('body')).toHaveClass(/present/);
  await expect.poll(async () => { const fit = await noteFit(page); return fit.lines > 0 && fit.sourceBottomOver <= 0 && fit.innerScroll <= 1 && fit.scrollTop === 0; }).toBe(true);
});

test('S3: in edit the note toolbar is a compact corner cluster that keeps the full note readable and every action reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  const note = page.locator('.grid-stack-item:has(.db-annotation)');
  const toolbar = note.locator('.tile-toolbar');
  // The whole note, source line included, is visible with the palette open.
  await expect.poll(async () => { const fit = await noteFit(page); return fit.lines > 0 && fit.sourceBottomOver <= 0 && fit.innerScroll <= 1; }).toBe(true);
  // The toolbar takes no rows from the note: it hangs from the tile's top edge
  // at the right, clear of GridStack's corner resize grip.
  const [tile, bar, grip] = await Promise.all([note.locator('.tile').boundingBox(), toolbar.boundingBox(), note.locator('.ui-resizable-ne').boundingBox()]);
  expect(bar.height).toBeLessThanOrEqual(32);
  expect(Math.abs(bar.y - tile.y)).toBeLessThanOrEqual(1);
  expect(bar.x + bar.width).toBeLessThanOrEqual(grip.x);
  expect(tile.x + tile.width - (bar.x + bar.width)).toBeLessThanOrEqual(30);
  await expect(note.locator('.tile-data-row')).toBeHidden();
  // Symbol labels at a 24px target; accessible names unchanged.
  for (const [selector, name] of [['.tile-arrange-btn', /^Move and resize /], ['.tile-settings > summary', /^Chart settings$/], ['.tile-remove', /^Remove /]]) {
    const control = toolbar.locator(selector);
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-label', name);
    const size = await control.boundingBox();
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(24);
  }
  await toolbar.locator('.tile-settings > summary').click();
  await expect(toolbar.locator('.tile-settings-body')).toBeVisible();
  await toolbar.locator('.tile-settings > summary').click();
  // Confirming a removal widens the toolbar to the tile, so the question is legible.
  await toolbar.getByRole('button', { name: /^Remove / }).click();
  const confirm = note.locator('.tile-remove-confirm');
  await expect(confirm).toBeVisible();
  expect((await confirm.boundingBox()).width).toBeGreaterThan(tile.width - 4);
  await expect(confirm.locator('.tpl-confirm-q')).toHaveText('Remove tile “About this dashboard”?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect((await toolbar.boundingBox()).width).toBeLessThan(140);
});
