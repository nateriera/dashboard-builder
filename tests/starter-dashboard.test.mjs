import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The empty-state default (src/data/starterDashboard.json, loaded by
// starterLayout() in src/main.js) is the canonical Meridian County
// homeless-response dashboard. These tests pin what a fresh profile opens on.
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document; globalThis.window = dom.window;
for (const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','getComputedStyle']) globalThis[key] = dom.window[key];
const { validateLayout } = await import('../src/data/layout.js');
const { TILE_TYPES, DATASETS, MERIDIAN_DATASETS } = await import('../src/tiles/registry.js');
const { applyFilters } = await import('../src/data/filters.js');

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const starter = read('../src/data/starterDashboard.json');
const example = read('../docs/examples/meridian-homeless-response.json');

test('starter: the default is the canonical example dashboard, without share metadata', () => {
  const { meta, savedAt, omittedDependencies, ...rest } = example;
  assert.deepEqual(starter, rest, 'src/data/starterDashboard.json and docs/examples/meridian-homeless-response.json differ beyond meta/savedAt');
  assert.equal(starter.meta, undefined, 'a default must not prefill another author\'s title, name or period into Share as HTML');
  assert.ok(meta.title, 'the example keeps its own share metadata');
});

test('starter: validates as a version 5 layout with five tiles that fit one present-mode screen', () => {
  const layout = validateLayout(structuredClone(starter));
  assert.equal(layout.version, 5);
  assert.deepEqual(layout.tiles.map(t => [t.id, t.type, t.dataset ?? null, t.x, t.y, t.w, t.h]), [
    ['count', 'line', 'flowActive', 0, 0, 7, 16],
    ['entries', 'donut', 'flowEntriesByGroup', 7, 0, 5, 16],
    ['what-if', 'line', 'flowWhatIf', 0, 16, 6, 14],
    ['flow', 'area', 'flowInOut', 6, 16, 6, 14],
    ['about', 'text', null, 0, 30, 12, 5]
  ]);
  for (const [i, a] of layout.tiles.entries()) for (const b of layout.tiles.slice(i + 1)) {
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
  }
  assert.ok(Math.max(...layout.tiles.map(t => t.y + t.h)) <= 35, 'fits one 1440×900 present-mode screen');
  assert.deepEqual(layout.defaultDataset, { kind: 'dataset', ref: 'flowEntriesByGroup' });
});

test('starter: every data tile is on a registered Meridian sample that carries its fields and a date to brush', () => {
  for (const t of starter.tiles) {
    const entry = TILE_TYPES[t.type];
    if (entry.noData) continue;
    assert.ok(Object.hasOwn(MERIDIAN_DATASETS, t.dataset), `${t.id}: ${t.dataset}`);
    assert.ok(entry.datasets.includes(t.dataset), `${t.dataset} is offered in the ${t.type} picker`);
    const columns = new Set(DATASETS[t.dataset].flatMap(row => Object.keys(row)));
    for (const f of entry.fields.filter(f => !f.optional)) assert.ok(columns.has(f.key), `${t.id} needs ${f.key}`);
    assert.ok(columns.has('date'), `${t.id}: a brush on another tile can filter it`);
  }
});

test('starter: the extra_exits parameter is bound to a filter that selects one what-if scenario', () => {
  assert.deepEqual(starter.parameters, [{ name: 'extra_exits', type: 'number', value: 0, min: 0, max: 40, step: 10, integer: true, bindings: [{ kind: 'filter', filterId: 'filter-extra-exits' }] }]);
  assert.deepEqual(starter.filters, [{ id: 'filter-extra-exits', field: 'extra_exits', op: 'is', values: [0], scope: 'charts', targets: [{ tileId: 'what-if', field: 'extra_exits' }] }]);
  const rows = DATASETS.flowWhatIf;
  for (const [extra, end] of [[0, 1396], [20, 1156], [40, 916]]) {
    const { rows: shown, applied } = applyFilters(rows, [{ ...starter.filters[0], values: [extra] }], { sourceTile: 'what-if' });
    assert.equal(applied, true);
    assert.equal(shown.length, 49, `${extra}: one scenario of 49 rows`);
    assert.equal(shown.at(-1).date, '2027-09');
    assert.equal(shown.at(-1).value, end, `September 2027 at +${extra}`);
  }
});

test('starter: brushing January–June 2026 turns the entries donut from 4,358 / 1,853 to 567 / 555', () => {
  const sum = rows => Object.fromEntries(['Single adults', 'Families', 'Youth 18–24', 'Veterans', 'Not recorded'].map(label => [label, rows.filter(r => r.label === label).reduce((s, r) => s + r.value, 0)]));
  assert.deepEqual(sum(DATASETS.flowEntriesByGroup), { 'Single adults': 4358, 'Families': 1853, 'Youth 18–24': 902, 'Veterans': 763, 'Not recorded': 326 });
  const brush = { id: 'cross-date-test', field: 'date', op: 'date-between', values: ['2026-01-01', '2026-06-01'], source: 'crossfilter', sourceTile: 'count', markValues: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] };
  const { rows: brushed } = applyFilters(DATASETS.flowEntriesByGroup, [brush], { sourceTile: 'entries' });
  assert.equal(applyFilters(DATASETS.flowActive, [brush], { sourceTile: 'count' }).applied, false, 'the brushed chart does not filter itself');
  assert.equal(brushed.length, 30);
  assert.deepEqual(sum(brushed), { 'Single adults': 567, 'Families': 555, 'Youth 18–24': 169, 'Veterans': 144, 'Not recorded': 60 });
});
