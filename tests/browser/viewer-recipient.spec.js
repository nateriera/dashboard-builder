import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { shareHtml } from './header-actions.js';
import { seedMeridianServicesStarter } from './meridian-services-starter.js';

const rows = [{ label: 'Housing', value: 12 }, { label: 'Food', value: 8 }, { label: 'Health', value: 5 }];
const bar = (id, extra = {}) => ({ id, type: 'bar', title: `Chart ${id}`, source: 'Intake log', x: 0, y: 0, w: 6, h: 15, rows, crossfilterField: 'label', ...extra });
const payloadOf = html => JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const viewerHtml = (html, payload) => html.replace('__DASHBOARD_PAYLOAD__', () => JSON.stringify({ app: 'dashboard-builder', version: 5, kind: 'dashboard-export', theme: 'paper', parameters: [], frozenParameters: [], exportedAt: '2026-11-03T14:05:09.000Z', exportedAtOffset: -300, ...payload }).replace(/</g, '\\u003c'));
async function template(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  return page.evaluate(async () => (await fetch('/export-template.html')).text());
}
async function ready(page) {
  await expect(page.locator('.export-tile svg').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('recipient front page: compact facts, literal cover note, contents and named reading links', async ({ page }) => {
  const html = await template(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const payload = {
    meta: { title: 'Service review', preparedBy: 'Operations', dataPeriod: 'Fall 2026', note: 'Please read <b>the detail</b>. https://example.com stays plain text.' },
    pages: [{ id: 'one', name: 'Overview' }, { id: 'two', name: 'Detail' }],
    filters: [{ id: 'category', field: 'label', op: 'is', values: [] }],
    tiles: [bar('a', { pageId: 'one' }), bar('b', { pageId: 'two' })]
  };
  await page.setContent(viewerHtml(html, payload));
  await ready(page);
  await expect(page.locator('.export-fact')).toHaveText(['Prepared by: Operations', 'Data period: Fall 2026']);
  await expect(page.locator('.export-meta')).toHaveText('Exported: 2026-11-03 09:05:09 UTC-05:00');
  await expect(page.locator('.export-cover-note')).toHaveText(payload.meta.note);
  await expect(page.locator('.export-cover-note *')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Contents', exact: true }).getByRole('link')).toHaveText(['Overview', 'Detail']);
  await expect(page.getByRole('navigation', { name: 'Continue from Overview' }).getByRole('link')).toHaveText('Next: Detail');
  await expect(page.getByRole('navigation', { name: 'Continue from Detail' }).getByRole('link')).toHaveText('Previous: Overview');
  expect(await page.locator('.export-tile').first().evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(400);
  expect(await page.getByRole('navigation', { name: 'Continue from Overview' }).evaluate(node => node.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(await page.locator('.export-tile').first().evaluate(node => node.getBoundingClientRect().bottom));
  await page.screenshot({ path: 'test-results/viewer-front-with-note.png', fullPage: true });
  await page.getByRole('link', { name: 'Next: Detail', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#page-two');
  await expect(page.locator('.export-attribution')).toHaveText('Built with Dashboard Builder');
  await expect(page.locator('.export-attribution')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.export-attribution')).toHaveCSS('color', 'rgb(58, 64, 84)');
  await expect(page.locator('.export-attribution')).toHaveCSS('font-size', '12px');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.export-cover-note')).toBeHidden();
  await expect(page.locator('.export-print-filters .export-print-cover-note')).toHaveText(payload.meta.note);
  await expect(page.locator('.export-print-filters .export-print-cover-note')).toBeVisible();
  for (const node of await page.locator('.export-page-tabs, .export-reading-nav, .export-attribution').all()) await expect(node).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  delete payload.meta.note;
  await page.setContent(viewerHtml(html, payload));
  await ready(page);
  await expect(page.locator('.export-cover-note')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/viewer-front-without-note.png', fullPage: true });
  payload.pages = [payload.pages[0]];
  await page.setContent(viewerHtml(html, payload));
  await expect(page.locator('.export-page-tabs')).toHaveCount(0);
});

test('as shared restores original filters, parameters, crossfilters, theme and saved-view selection', async ({ page }) => {
  const html = await template(page);
  const filters = [{ id: 'category', field: 'label', label: 'Service category', op: 'is', values: ['Housing'] }, { id: 'range', field: 'value', op: 'between', values: [1, 20] }];
  const parameters = [{ name: 'category', label: 'Selected service', type: 'text', value: 'Housing', bindings: [{ kind: 'filter', filterId: 'category' }] }];
  await page.setContent(viewerHtml(html, {
    filters, parameters, currentPageId: 'one', pages: [{ id: 'one', name: 'One' }],
    savedViews: [{ id: 'empty', name: 'Unfiltered', filters: [], parameters, theme: 'paper', currentPageId: 'one' }, { id: 'v', name: 'Food view', filters: [{ ...filters[0], values: ['Food'] }, filters[1]], parameters: [{ ...parameters[0], value: 'Food' }], theme: 'dusk', currentPageId: 'one' }],
    tiles: [bar('a', { pageId: 'one' })]
  }));
  await ready(page);
  const reset = page.getByRole('button', { name: 'Reset to as shared' });
  await expect(reset).toBeHidden();
  await page.getByLabel('Saved dashboard view', { exact: true }).selectOption('v');
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page.getByLabel('Saved dashboard view', { exact: true })).toHaveValue('');
  await expect(reset).toBeHidden();
  await expect(page.locator('.export-filter > span').first()).toHaveText('Service category');
  await expect(page.locator('.export-parameter-control > span').nth(1)).toHaveText('Selected service');
  await page.getByLabel('category', { exact: true }).fill('Food');
  await page.getByLabel('value maximum').fill('10');
  await expect(reset).toBeVisible();
  const summary = page.locator('.export-print-filters');
  await expect(summary).toBeVisible();
  const screenText = await summary.textContent();
  expect(screenText).toContain('Selected service: Food');
  await page.emulateMedia({ media: 'print' });
  await expect(summary).toHaveText(screenText);
  await expect(reset).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByLabel('Saved dashboard view', { exact: true }).selectOption('v');
  await page.getByRole('button', { name: 'Apply view' }).click();
  await expect(page.getByLabel('category', { exact: true })).toHaveValue('Food');
  await expect(page.getByLabel('Saved dashboard view', { exact: true })).toHaveValue('v');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dusk');
  await reset.click();
  await expect(page.getByLabel('category', { exact: true })).toHaveValue('Housing');
  await expect(page.getByLabel('value maximum')).toHaveValue('20');
  await expect(page.getByLabel('Saved dashboard view', { exact: true })).toHaveValue('');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expect(reset).toBeHidden();
  await page.locator('.export-tile svg [aria-label^="Category: "]').first().click();
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(1);
  await reset.click();
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(0);
  await expect(reset).toBeHidden();
  await page.getByLabel('Saved dashboard view', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: 'Apply view' }).click();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Service category: Not applied');
  await expect(page.locator('.export-filters')).toHaveCount(0);
  await reset.click();
  await expect(page.getByLabel('category', { exact: true })).toHaveValue('Housing');
  await expect(reset).toBeHidden();
});

test('desktop tile layout matches the pre-slice screenshot at 1280px', async ({ page }) => {
  const html = await template(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(viewerHtml(html, { filters: [], tiles: [bar('a'), bar('b', { x: 6 }), bar('c', { y: 15, w: 12 })] }));
  await ready(page);
  await expect(page.locator('.export-grid')).toHaveScreenshot('viewer-desktop-grid.png', { maxDiffPixels: 0, animations: 'disabled' });
});

test('below 700px tiles stack in reading order, charts resize and tables scroll inside the tile', async ({ page }) => {
  const html = await template(page);
  const tableRows = [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Column ${i}`, 'A long cell value for horizontal scrolling']))];
  await page.setViewportSize({ width: 700, height: 800 });
  await page.setContent(viewerHtml(html, { filters: [], tiles: [bar('a'), bar('b', { x: 6 }), { id: 'table', type: 'table', title: 'Records', source: '', x: 0, y: 15, w: 12, h: 15, rows: tableRows }] }));
  await ready(page);
  const rects = () => page.locator('.export-tile').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { id: node.dataset.tileId, x: r.x, top: r.top, bottom: r.bottom, width: r.width }; }));
  let positions = await rects();
  expect(positions[0].top).toBe(positions[1].top);
  const desktopChartWidth = await page.locator('.export-tile svg').first().evaluate(node => node.getBoundingClientRect().width);
  await page.setViewportSize({ width: 699, height: 800 });
  await expect.poll(async () => (await rects())[1].top > (await rects())[0].bottom).toBe(true);
  await expect.poll(() => page.locator('.export-tile svg').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(desktopChartWidth);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.export-tile svg').first().evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(350);
  positions = await rects();
  expect(positions.map(item => item.id)).toEqual(['a', 'b', 'table']);
  expect(new Set(positions.map(item => item.x)).size).toBe(1);
  for (let i = 1; i < positions.length; i++) expect(positions[i].top).toBeGreaterThanOrEqual(positions[i - 1].bottom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const scroller = page.locator('[data-tile-id="table"] .db-data-table-scroll');
  expect(await scroller.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await scroller.evaluate(node => { node.scrollLeft = 100; });
  expect(await scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/viewer-phone-stack.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.export-grid')).toHaveCSS('display', 'block');
});

test('cover note is capped, share-only, verbatim and protected inside the envelope', async ({ page, context }) => {
  test.setTimeout(120000);
  await seedMeridianServicesStarter(page);
  await template(page);
  const layout = () => page.evaluate(() => { const { savedAt, ...layout } = JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')); return JSON.stringify(layout); });
  const before = await layout();
  await page.locator('#btn-export-html').click();
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog.getByLabel('Cover note', { exact: true })).toHaveAttribute('maxlength', '480');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const note = '  Author-only cover sentinel <b>read carefully</b>  ';
  let download = page.waitForEvent('download');
  await shareHtml(page, { 'Cover note': note });
  const plain = await fs.readFile(await (await download).path(), 'utf8');
  const payload = payloadOf(plain);
  expect(payload.meta.note).toBe(note);
  expect(payload.layout.meta?.note).toBeUndefined();
  expect(await layout()).toBe(before);
  await expect(page.getByText('Built with Dashboard Builder', { exact: true })).toHaveCount(0);
  await page.locator('#btn-export-html').click();
  await expect(dialog.getByLabel('Cover note', { exact: true })).toHaveValue(note);
  await dialog.getByLabel('Protect with password').check();
  await dialog.getByLabel('Password (at least 12 characters)').fill('recipient-test-password');
  await dialog.getByLabel('Confirm password').fill('recipient-test-password');
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  const protectedHtml = await fs.readFile(await (await download).path(), 'utf8');
  expect(protectedHtml).not.toContain('Author-only cover sentinel');
  expect(payloadOf(protectedHtml).encrypted).toBe(true);
  expect(await layout()).toBe(before);
  const viewer = await context.newPage();
  await viewer.route('**/recipient-protected.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: protectedHtml }));
  await viewer.goto('/recipient-protected.html');
  await expect(viewer.locator('.export-unlock')).toBeVisible();
  await expect(viewer.locator('.export-unlock')).toHaveCSS('padding', '32px');
  await expect(viewer.locator('.export-unlock h1')).toHaveCSS('font-size', '28px');
  await viewer.screenshot({ path: 'test-results/viewer-unlock-restyle.png' });
  await viewer.getByLabel('Password').fill('recipient-test-password');
  await viewer.getByRole('button', { name: 'Unlock' }).click();
  await expect(viewer.locator('.export-cover-note')).toHaveText(note);
  expect(await viewer.locator('.export-cover-note').textContent()).toBe(note);
  await viewer.close();
});
