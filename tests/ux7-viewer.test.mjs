import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/' });
globalThis.document = dom.window.document; globalThis.window = dom.window;
for (const key of ['Node', 'Element', 'HTMLElement', 'SVGElement', 'NodeList', 'HTMLCollection', 'CustomEvent', 'getComputedStyle']) globalThis[key] = dom.window[key];
const { validateLayout } = await import('../src/data/layout.js');
const { exportMetaFacts, metaFromInputs, validateLayoutMeta, META_MAX_LENGTH } = await import('../src/data/layoutMeta.js');
const { exportFactLines, tileSourceLine, formatExportStamp, filterAppliesToPage, crossfilterShownOnPage, packTileRows, describeFilterValue, printFilterSummary, viewerStateEquals } = await import('../src/export/viewerModel.js');

const envelope = extra => ({ app: 'dashboard-builder', version: 5, rowHeight: 24, tiles: [], ...extra });
// serialize → JSON → validate, as autosave/export/import do.
const roundTrip = layout => validateLayout(JSON.parse(JSON.stringify(validateLayout(layout))));

test('UX-7 D1: present metadata round-trips through serialize/validate unchanged, version stays 5', () => {
  const meta = { title: 'Quarterly review', preparedBy: 'Klaro Impact', dataPeriod: 'Jul–Sep 2026' };
  const result = roundTrip(envelope({ meta }));
  assert.deepEqual(result.meta, meta);
  assert.equal(result.version, 5);
});

test('UX-7 D1: blank metadata round-trips as blanks (export stays possible with all three empty)', () => {
  const meta = { title: '', preparedBy: '', dataPeriod: '' };
  assert.deepEqual(roundTrip(envelope({ meta })).meta, meta);
  assert.deepEqual(roundTrip(envelope({ meta: { title: 'Only a title' } })).meta, { title: 'Only a title', preparedBy: '', dataPeriod: '' });
});

test('UX-7 D1: absent metadata stays absent; older layout versions load unchanged', () => {
  for (const version of [1, 4, 5]) {
    const result = roundTrip({ app: 'dashboard-builder', version, ...(version >= 3 ? { rowHeight: 24 } : {}), tiles: [] });
    assert.equal(Object.hasOwn(result, 'meta'), false, `v${version}`);
  }
});

test('UX-7 D1: metadata is validated, length-capped and limited to its three fields', () => {
  assert.throws(() => validateLayout(envelope({ meta: { title: 7 } })), /metadata: title/);
  assert.throws(() => validateLayout(envelope({ meta: 'title' })), /Invalid dashboard metadata/);
  assert.throws(() => validateLayout(envelope({ meta: { dataPeriod: 'x'.repeat(META_MAX_LENGTH + 1) } })), /dataPeriod/);
  assert.deepEqual(validateLayoutMeta({ title: 'T', author: 'dropped' }), { title: 'T', preparedBy: '', dataPeriod: '' });
});

test('UX-7 V1: modal values are trimmed and an all-blank form stores nothing', () => {
  assert.equal(metaFromInputs({ title: '  ', preparedBy: '', dataPeriod: '\t' }), undefined);
  assert.deepEqual(metaFromInputs({ title: ' Review ', preparedBy: 'Nate ', dataPeriod: '' }), { title: 'Review', preparedBy: 'Nate', dataPeriod: '' });
});

test('UX-7 V1: payload fallbacks for missing metadata are explicit and never inferred', () => {
  const fallback = { title: 'Untitled dashboard', preparedBy: 'Not provided', dataPeriod: 'Not specified' };
  assert.deepEqual(exportMetaFacts(undefined), fallback);
  assert.deepEqual(exportMetaFacts(null), fallback);
  assert.deepEqual(exportMetaFacts({ title: '', preparedBy: '   ', dataPeriod: '' }), fallback);
  assert.deepEqual(exportMetaFacts({ title: 'Board pack' }), { ...fallback, title: 'Board pack' });
  assert.deepEqual(exportMetaFacts({ title: 'A', preparedBy: 'B', dataPeriod: 'C' }), { title: 'A', preparedBy: 'B', dataPeriod: 'C' });
});

test('Viewer empty-state parity: blank Prepared by, Data period and tile source print no line; present values print as before', () => {
  for (const meta of [undefined, null, {}, { title: 'T', preparedBy: '', dataPeriod: '' }, { preparedBy: '   ', dataPeriod: '\t' }]) assert.deepEqual(exportFactLines(meta), []);
  assert.deepEqual(exportFactLines({ preparedBy: ' Klaro Impact ', dataPeriod: 'Jul–Sep 2026' }), ['Prepared by: Klaro Impact', 'Data period: Jul–Sep 2026']);
  assert.deepEqual(exportFactLines({ preparedBy: '', dataPeriod: 'Q3' }), ['Data period: Q3']);
  assert.deepEqual(exportFactLines({ preparedBy: 'Nate', dataPeriod: ' ' }), ['Prepared by: Nate']);
  for (const source of [undefined, null, '', '   ', 42]) assert.equal(tileSourceLine(source), null);
  assert.equal(tileSourceLine(' Intake log '), 'Source: Intake log');
});

test('UX-7 V2: export timestamp formats as YYYY-MM-DD HH:mm:ss UTC±HH:mm', () => {
  assert.equal(formatExportStamp('2026-11-03T14:05:09.000Z', -300), '2026-11-03 09:05:09 UTC-05:00');
  assert.equal(formatExportStamp('2026-11-03T14:05:09.000Z', 330), '2026-11-03 19:35:09 UTC+05:30');
  assert.equal(formatExportStamp('2026-11-03T23:59:59.000Z', 0), '2026-11-03 23:59:59 UTC+00:00');
  assert.equal(formatExportStamp('2026-01-01T02:00:00.000Z', -180), '2025-12-31 23:00:00 UTC-03:00');
  assert.equal(formatExportStamp('not a date', 0), null);
});

const rows = [{ label: 'A', value: 1 }];
const tiles = [
  { id: 'a', pageId: 'p1', rows },
  { id: 'b', pageId: 'p2', rows },
  { id: 'c', pageId: 'p2', rows: [{ other: 1 }] },
  { id: 'err', pageId: 'p3', rows: null }
];

test('UX-7 V3: a filter belongs to a page group only where its real scope and targets act', () => {
  const dashboard = { id: 'd', field: 'label', op: 'is', values: [] };
  const page = { id: 'p', field: 'label', op: 'is', values: [], scope: 'page', pageId: 'p2' };
  const charts = { id: 'c', field: 'label', op: 'is', values: [], scope: 'charts', targets: [{ tileId: 'a', field: 'label' }] };
  const missingField = { id: 'm', field: 'region', op: 'is', values: [] };
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => filterAppliesToPage(dashboard, id, tiles)), [true, true, false]);
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => filterAppliesToPage(page, id, tiles)), [false, true, false]);
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => filterAppliesToPage(charts, id, tiles)), [true, false, false]);
  assert.deepEqual(['p1', 'p2'].map(id => filterAppliesToPage(missingField, id, tiles)), [false, false]);
});

test('UX-7 V3: a crossfilter selection shows on its source page and every page it acts on', () => {
  const selection = { id: 'x', field: 'label', op: 'is', values: ['A'], source: 'crossfilter', sourceTile: 'a' };
  assert.equal(crossfilterShownOnPage(selection, 'p1', tiles), true);
  assert.equal(crossfilterShownOnPage(selection, 'p2', tiles), true);
  assert.equal(crossfilterShownOnPage(selection, 'p3', tiles), false);
  const onlySource = [{ id: 'a', pageId: 'p1', rows }, { id: 'z', pageId: 'p2', rows: [{ other: 1 }] }];
  assert.equal(crossfilterShownOnPage(selection, 'p2', onlySource), false);
});

test('UX-7 V5: rows pack at content height, keeping side-by-side and spanning arrangement', () => {
  const left = { id: 'left', x: 0, y: 0, w: 6, h: 30 }, topRight = { id: 'tr', x: 6, y: 0, w: 6, h: 15 };
  const bottomRight = { id: 'br', x: 6, y: 15, w: 6, h: 15 }, gapped = { id: 'g', x: 0, y: 90, w: 12, h: 6 };
  const placement = packTileRows([left, topRight, bottomRight, gapped]);
  assert.deepEqual(placement.get(left), { rowStart: 1, rowEnd: 3 });
  assert.deepEqual(placement.get(topRight), { rowStart: 1, rowEnd: 2 });
  assert.deepEqual(placement.get(bottomRight), { rowStart: 2, rowEnd: 3 });
  // A 60-row empty gap in the editor becomes no empty rows in the export.
  assert.deepEqual(placement.get(gapped), { rowStart: 3, rowEnd: 4 });
});

test('UX-7 V5: print summary describes each applicable filter in words', () => {
  assert.equal(describeFilterValue({ op: 'is', values: ['Housing', null] }), 'Housing, (blank)');
  assert.equal(describeFilterValue({ op: 'is-not', values: ['Food'] }), 'not Food');
  assert.equal(describeFilterValue({ op: 'is', values: [] }), 'All');
  assert.equal(describeFilterValue({ op: 'between', values: [1, 20] }), '1–20');
  assert.equal(describeFilterValue({ op: 'date-between', values: ['2026-01-01', '2026-02-01'], relativePreset: 'last-30-days' }), 'Last 30 days');
  assert.equal(printFilterSummary([]), null);
  assert.equal(printFilterSummary([{ label: 'label', value: 'Housing' }, { label: 'value', value: '1–20' }]), 'Filters at print time: label: Housing; value: 1–20');
});

test('UX-7 V3: Restore is disabled exactly when the working state equals the exported state', () => {
  const base = { filters: [{ id: 'f', field: 'label', op: 'is', values: ['A'] }, { id: 'x', field: 'label', op: 'is', values: ['B'], source: 'crossfilter', sourceTile: 't' }], parameters: [{ name: 'p', value: 1 }] };
  const same = JSON.parse(JSON.stringify(base));
  assert.equal(viewerStateEquals(same, base), true);
  assert.equal(viewerStateEquals({ ...same, filters: [{ ...same.filters[0], values: ['C'] }, same.filters[1]] }, base), false);
  assert.equal(viewerStateEquals({ ...same, filters: [same.filters[0]] }, base), false, 'cleared exported crossfilter');
  assert.equal(viewerStateEquals({ ...same, filters: [...same.filters, { id: 'y', field: 'label', op: 'is', values: ['A'], source: 'crossfilter', sourceTile: 'u' }] }, base), false, 'new selection');
  assert.equal(viewerStateEquals({ ...same, parameters: [{ name: 'p', value: 2 }] }, base), false);
  assert.equal(viewerStateEquals({ ...same, filters: [{ ...same.filters[0], relativePreset: 'last-7-days' }, same.filters[1]] }, base), false);
});
