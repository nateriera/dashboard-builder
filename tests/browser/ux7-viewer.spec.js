import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { shareHtml } from './header-actions.js';

// UX-7: exported viewer variant (title block, conditional filters, one
// document with anchor navigation, cards, print).

const rows = [{ label: 'Housing', value: 12 }, { label: 'Food', value: 8 }, { label: 'Health', value: 5 }];
const payloadOf = html => JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);

async function template(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  return page.evaluate(async () => await (await fetch('/export-template.html')).text());
}
const viewerHtml = (html, payload) => html.replace('__DASHBOARD_PAYLOAD__', () => JSON.stringify({ app: 'dashboard-builder', version: 5, kind: 'dashboard-export', theme: 'paper', parameters: [], frozenParameters: [], exportedAt: '2026-11-03T14:05:09.000Z', exportedAtOffset: -300, ...payload }).replace(/</g, '\\u003c'));
const bar = (id, extra = {}) => ({ id, type: 'bar', title: `Chart ${id}`, source: 'Intake log', x: 0, y: 0, w: 6, h: 15, rows, crossfilterField: 'label', ...extra });

test('V1/V2: Share as HTML collects metadata, the title block renders it, and the modal prefills next time', async ({ page, context }) => {
  await template(page);
  // Cancel leaves the dashboard untouched and downloads nothing.
  let downloads = 0; page.on('download', () => downloads++);
  const before = await page.evaluate(() => localStorage.getItem('dashboard-builder:layout:v1'));
  await page.locator('#btn-export-html').click();
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog.getByLabel('Data period')).toHaveAccessibleDescription('Describe the dates covered by the data. This is not the export date.');
  await dialog.getByLabel('Dashboard title').fill('Should not persist');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('#btn-export-html').click();
  await expect(dialog.getByLabel('Dashboard title')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('dashboard-builder:layout:v1'))).toBe(before);

  const downloading = page.waitForEvent('download');
  await shareHtml(page, { 'Dashboard title': 'Quarterly service review', 'Prepared by': 'Klaro Impact', 'Data period': 'July–September 2026' });
  const html = await fs.readFile(await (await downloading).path(), 'utf8');
  const payload = payloadOf(html);
  expect(payload.meta).toEqual({ title: 'Quarterly service review', preparedBy: 'Klaro Impact', dataPeriod: 'July–September 2026' });
  expect(payload.layout.meta).toEqual(payload.meta);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1') || '{}').meta)).toEqual(payload.meta);

  const viewer = await context.newPage();
  await viewer.setContent(html);
  await expect(viewer).toHaveTitle('Quarterly service review');
  const head = viewer.locator('.export-head');
  await expect(head.locator('.export-badge')).toHaveText('Offline snapshot');
  await expect(head.locator('.export-badge')).toHaveCSS('background-color', 'rgb(183, 191, 217)');
  await expect(head.locator('h1')).toHaveText('Quarterly service review');
  await expect(head.locator('h1')).toHaveCSS('font-size', '32px');
  await expect(head.locator('.export-fact')).toHaveText(['Prepared by: Klaro Impact', 'Data period: July–September 2026']);
  await expect(head.locator('.export-meta')).toHaveText(/^Exported: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/);
  await expect(head.locator('.export-note')).toHaveText('This file contains the data included at export. It works offline and does not update automatically.');
  // Single page: no navigation, no page heading repeating the title.
  await expect(viewer.locator('.export-page-tabs, .export-page-heading')).toHaveCount(0);
  await viewer.close();

  await page.locator('#btn-export-html').click();
  await expect(dialog.getByLabel('Dashboard title')).toHaveValue('Quarterly service review');
  await expect(dialog.getByLabel('Prepared by')).toHaveValue('Klaro Impact');
  await expect(dialog.getByLabel('Data period')).toHaveValue('July–September 2026');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('V2: the title block shows explicit fallbacks for blank or absent metadata', async ({ page, context }) => {
  await template(page);
  const downloading = page.waitForEvent('download');
  await shareHtml(page);
  const html = await fs.readFile(await (await downloading).path(), 'utf8');
  expect(payloadOf(html).meta).toBeUndefined();
  for (const content of [html, viewerHtml(await page.evaluate(async () => await (await fetch('/export-template.html')).text()), { tiles: [bar('a')], meta: { title: ' ', preparedBy: '', dataPeriod: '' } })]) {
    const viewer = await context.newPage();
    await viewer.setContent(content);
    await expect(viewer).toHaveTitle('Untitled dashboard');
    await expect(viewer.locator('.export-head h1')).toHaveText('Untitled dashboard');
    await expect(viewer.locator('.export-fact')).toHaveText(['Prepared by: Not provided', 'Data period: Not specified']);
    await viewer.close();
  }
});

test('V3: an export with no editable filters has no filter region and no Restore button until a selection exists', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, { filters: [], tiles: [bar('a'), bar('b', { x: 6 })] }));
  await expect(page.locator('.export-tile svg').first()).toBeVisible();
  await expect(page.locator('.export-filters')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore exported filters' })).toHaveCount(0);
  await expect(page.getByText('Filter this dashboard')).toHaveCount(0);
  // A crossfilter selection is something functional to show; clearing it removes the region again.
  await page.locator('.export-tile[data-tile-id="a"] svg [aria-label^="Category: "]').first().click();
  await expect(page.locator('.export-filters')).toHaveCount(1);
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(1);
  await page.locator('.export-crossfilter-chip').click();
  await expect(page.locator('.export-filters')).toHaveCount(0);
});

test('V3: Restore returns to the exported values (not all data), clears new selections, and is disabled at the exported state', async ({ page }) => {
  const html = await template(page);
  const exportedSelection = { id: 'cross-1', field: 'label', op: 'is', values: ['Housing', 'Food'], source: 'crossfilter', sourceTile: 'a' };
  await page.setContent(viewerHtml(html, {
    filters: [{ id: 'f-label', field: 'label', op: 'is', values: ['Housing', 'Food'], scope: 'charts', targets: [{ tileId: 'b', field: 'label' }, { tileId: 'c', field: 'label' }] }, exportedSelection],
    tiles: [bar('a'), bar('b', { x: 6 }), bar('c', { y: 15, w: 12 })]
  }));
  const group = page.locator('.export-filters');
  await expect(group.getByRole('heading', { name: 'Filter this dashboard' })).toBeVisible();
  await expect(group.locator('.export-filters-caption')).toHaveText('Changes affect this file only.');
  const restore = group.getByRole('button', { name: 'Restore exported filters' });
  await expect(group.locator('button').last()).toHaveText('Restore exported filters');
  await expect(restore).toBeDisabled();
  const summary = page.locator('.export-tile[data-tile-id="b"] .chart-data summary');
  await expect(summary).toContainText('(2 rows)');
  const select = group.getByLabel('label values');
  await select.selectOption([JSON.stringify('Housing')]);
  await expect(summary).toContainText('(1 rows)');
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(summary).toContainText('(2 rows)');
  await expect.poll(() => select.evaluate(node => [...node.selectedOptions].map(option => option.value))).toEqual([JSON.stringify('Housing'), JSON.stringify('Food')]);
  await expect(restore).toBeDisabled();
  // Clearing the exported selection enables Restore; Restore brings the exported selection back.
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(1);
  await page.locator('.export-crossfilter-chip').click();
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(0);
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(page.locator('.export-crossfilter-chip')).toHaveCount(1);
  await expect(restore).toBeDisabled();
});

test('V3: an emptied chart keeps its card, title and source with the no-data message', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, { filters: [{ id: 'f', field: 'value', op: 'between', values: [1, 20] }], tiles: [bar('a')] }));
  await page.getByLabel('value minimum').fill('100');
  await page.getByLabel('value maximum').fill('200');
  const card = page.locator('.export-tile[data-tile-id="a"] .export-card');
  await expect(card.locator('.export-tile-empty')).toHaveText('No data matches these filters.');
  await expect(card.locator('h3')).toHaveText('Chart a');
  await expect(card.locator('.export-card-source')).toHaveText('Source: Intake log');
});

test('V4/D2: a multi-page export shows every page in one document with anchor navigation, canonical tabs and synced dashboard filters', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, {
    pages: [{ id: 'overview', name: 'Overview' }, { id: 'detail', name: 'Detail with a long, descriptive page name' }, { id: 'notes', name: 'Notes' }],
    filters: [{ id: 'global', field: 'label', op: 'is', values: ['Housing', 'Food'] }, { id: 'local', field: 'value', op: 'between', values: [1, 20], scope: 'page', pageId: 'detail' }],
    tiles: [bar('a', { pageId: 'overview' }), bar('b', { pageId: 'detail', source: '' }), bar('c', { pageId: 'detail', x: 6 })]
  }));
  const tabs = page.locator('.export-page-tabs a');
  await expect(tabs).toHaveText(['Overview', 'Detail with a long, descriptive page name', 'Notes']);
  expect(await tabs.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['#page-overview', '#page-detail', '#page-notes']);
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
  await expect(tabs.first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(tabs.first()).toHaveCSS('color', 'rgb(30, 35, 71)');
  await tabs.first().hover();
  await expect(tabs.first()).toHaveCSS('background-color', 'rgb(231, 227, 217)');
  // Every page's charts are in the document and visible; nothing is hidden.
  await expect(page.locator('.export-page')).toHaveCount(3);
  await expect(page.locator('.export-tile:visible')).toHaveCount(3);
  await expect(page.locator('.export-page-heading')).toHaveText(['Overview', 'Detail with a long, descriptive page name', 'Notes']);
  await expect(page.locator('.export-page[data-page-id="notes"] .export-notice')).toHaveText('This page contains no charts.');
  await expect(page.locator('.export-page[data-page-id="notes"] .export-filters, .export-page[data-page-id="notes"] .export-grid')).toHaveCount(0);
  await expect(page.locator('.export-tile[data-tile-id="b"] .export-card-source')).toHaveText('Source: Not provided');
  // Anchor navigation: the targeted page heading gets the dusk outline.
  await tabs.nth(1).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#page-detail');
  await expect(page.locator('#page-detail')).toHaveCSS('outline-color', 'rgb(74, 82, 120)');
  await expect(page.locator('#page-overview')).toHaveCSS('outline-style', 'none');
  // Page-scoped filter only in its page's group; the dashboard filter in each, one state.
  const overview = page.locator('.export-page[data-page-id="overview"] .export-filters');
  const detail = page.locator('.export-page[data-page-id="detail"] .export-filters');
  await expect(overview.getByLabel('value minimum')).toHaveCount(0);
  await expect(detail.getByLabel('value minimum')).toHaveCount(1);
  await overview.getByLabel('label values').selectOption([JSON.stringify('Food')]);
  await expect.poll(() => detail.getByLabel('label values').evaluate(node => [...node.selectedOptions].map(option => option.value))).toEqual([JSON.stringify('Food')]);
  await expect(page.locator('.export-tile[data-tile-id="c"] .chart-data summary')).toContainText('(1 rows)');
  await expect(detail.getByRole('button', { name: 'Restore exported filters' })).toBeEnabled();
  await detail.getByRole('button', { name: 'Restore exported filters' }).click();
  await expect.poll(() => overview.getByLabel('label values').evaluate(node => [...node.selectedOptions].map(option => option.value))).toEqual([JSON.stringify('Housing'), JSON.stringify('Food')]);
  await expect(overview.getByRole('button', { name: 'Restore exported filters' })).toBeDisabled();
});

test('D2: a parameter bound to a dashboard filter renders in every page group from one shared state', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, {
    pages: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }],
    filters: [{ id: 'bound', field: 'label', op: 'is', values: ['Housing'] }],
    parameters: [{ name: 'category', type: 'text', value: 'Housing', bindings: [{ kind: 'filter', filterId: 'bound' }] }],
    tiles: [bar('a', { pageId: 'one' }), bar('b', { pageId: 'two' })]
  }));
  const controls = page.locator('.export-parameter-control input[aria-label="category"]');
  await expect(controls).toHaveCount(2);
  await controls.first().fill('Food');
  await expect(controls.last()).toHaveValue('Food');
  await expect(page.locator('.export-tile[data-tile-id="b"] .chart-data summary')).toContainText('(1 rows)');
  await expect(page.locator('.export-tile[data-tile-id="b"] .chart-data summary')).toContainText('Chart b');
  await page.locator('.export-page[data-page-id="two"]').getByRole('button', { name: 'Restore exported filters' }).click();
  for (const control of await controls.all()) await expect(control).toHaveValue('Housing');
});

test('V5: cards are content height with footers inside, KPI figures at 32px, and editor gaps do not carry over', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, {
    filters: [],
    tiles: [bar('a', { h: 60 }), { id: 'k', type: 'kpi', title: 'Totals', source: 'Ledger', x: 6, y: 0, w: 6, h: 9, rows: [{ value: '1,287', label: 'Cases' }] }, bar('c', { y: 120, w: 12 })]
  }));
  const card = page.locator('.export-tile[data-tile-id="a"] .export-card');
  await expect(card.locator('h3')).toHaveText('Chart a');
  const footer = card.locator('.export-card-footer');
  await expect(footer.locator('.export-card-source')).toHaveText('Source: Intake log');
  await expect(footer.locator('details.chart-data summary')).toHaveText('View data for Chart a (3 rows)');
  await expect(card.locator('.export-card-notes')).toHaveCount(0);
  await expect(page.locator('.db-kpi-value')).toHaveCSS('font-size', '32px');
  await expect(page.locator('.db-kpi-value')).toHaveCSS('font-variant-numeric', 'tabular-nums');
  const geometry = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.export-tile')].map(tile => [tile.dataset.tileId, { top: tile.getBoundingClientRect().top, bottom: tile.getBoundingClientRect().bottom, height: tile.getBoundingClientRect().height, card: tile.querySelector('.export-card').getBoundingClientRect().height }])));
  // 60 editor rows would be 1440px; the card is its content height instead.
  expect(geometry.a.height).toBe(geometry.a.card);
  expect(geometry.a.height).toBeLessThan(1000);
  expect(geometry.k.top).toBe(geometry.a.top);
  // The 60-row empty editor gap does not become empty space: the next row starts right after the tallest card.
  expect(geometry.c.top - Math.max(geometry.a.bottom, geometry.k.bottom)).toBe(24);
});

test('V5: print hides data tables (even open), controls, navigation and badge; prints a filter summary and breaks before each page', async ({ page }) => {
  const html = await template(page);
  await page.setContent(viewerHtml(html, {
    pages: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }],
    savedViews: [{ id: 'v', name: 'View', theme: 'paper', currentPageId: 'one', filters: [], parameters: [] }],
    filters: [{ id: 'f', field: 'label', op: 'is', values: ['Housing', 'Food'] }, { id: 'r', field: 'value', op: 'between', values: [1, 20], scope: 'page', pageId: 'two' }],
    tiles: [bar('a', { pageId: 'one' }), bar('b', { pageId: 'two' })]
  }));
  const details = page.locator('.export-tile[data-tile-id="a"] details.chart-data');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(page.locator('.export-print-filters')).toHaveCount(2);
  await expect(page.locator('.export-print-filters').first()).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  for (const selector of ['details.chart-data', '.export-filters', '.export-restore', '.export-page-tabs', '.export-badge', '.export-saved-views']) {
    for (const node of await page.locator(selector).all()) await expect(node, selector).toBeHidden();
  }
  await expect(page.locator('.export-print-filters')).toHaveText(['Filters at print time: label: Housing, Food', 'Filters at print time: label: Housing, Food; value: 1–20']);
  for (const selector of ['.export-head h1', '.export-fact >> nth=0', '.export-meta', '.export-page-heading >> nth=1', '.export-tile svg >> nth=0', '.export-card-source >> nth=0']) await expect(page.locator(selector), selector).toBeVisible();
  expect(await page.locator('.export-page').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).breakBefore))).toEqual(['auto', 'page']);
  expect(await page.locator('.export-tile').first().evaluate(node => getComputedStyle(node).breakInside)).toBe('avoid');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.export-filters').first()).toBeVisible();
});

test('Offline contract: a generated export renders fully with networking disabled and makes no requests', async ({ page, browser }) => {
  await template(page);
  const downloading = page.waitForEvent('download');
  await shareHtml(page, { 'Dashboard title': 'Offline check' });
  const html = await fs.readFile(await (await downloading).path(), 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=["']https?:|@import\s+url\(["']?https?:|fonts\.googleapis/i);
  const context = await browser.newContext({ offline: true });
  try {
    const viewer = await context.newPage();
    const requests = [], failures = [], errors = [];
    viewer.on('request', request => { if (!/^(data|blob|about):/.test(request.url())) requests.push(request.url()); });
    viewer.on('requestfailed', request => failures.push(request.url()));
    viewer.on('pageerror', error => errors.push(error.message));
    await viewer.setContent(html, { waitUntil: 'load' });
    await expect(viewer.locator('.export-head h1')).toHaveText('Offline check');
    const expected = payloadOf(html).tiles.length;
    await expect(viewer.locator('.export-tile')).toHaveCount(expected);
    await expect(viewer.locator('.export-tile .export-card')).toHaveCount(expected);
    await expect(viewer.locator('.export-tile-error')).toHaveCount(0);
    expect(await viewer.evaluate(async () => { await document.fonts.ready; return ['Raleway', 'Inter', 'JetBrains Mono'].map(family => document.fonts.check(`16px "${family}"`)); })).toEqual([true, true, true]);
    expect({ requests, failures, errors }).toEqual({ requests: [], failures: [], errors: [] });
  } finally { await context.close(); }
});
