// Exemplar templates: every built-in template validates, references only
// registered Meridian datasets shaped for its tiles (default mappings), and
// renders every tile without an error. Also covers the small-multiples sort
// option and the seeded generator (anchors + byte-identical regeneration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/', pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'NodeList', 'HTMLCollection', 'CustomEvent', 'getComputedStyle']) {
  try { globalThis[k] = k === 'window' ? dom.window : dom.window[k]; } catch { /* read-only global */ }
}
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

const { TILE_TYPES, DATASETS, CORE_DATASET_KEYS, MERIDIAN_DATASETS } = await import('../src/tiles/registry.js');
const { BUILT_IN_TEMPLATES } = await import('../src/templates.js');
const { validateLayout } = await import('../src/data/layout.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = [
  'homeless-system-performance', 'behavioral-health-quality', 'health-center-quality', 'overdose-surveillance',
  'community-health-by-place', 'program-outcomes', 'system-flow', 'city-services-311', 'performance-scorecard',
  'executive-overview', 'sales-performance'
];

test('gallery lists the 11 exemplar templates in the ruled order (flagship first, general last)', () => {
  assert.deepEqual(BUILT_IN_TEMPLATES.map(t => t.id), ORDER);
  for (const cut of ['trend-deep-dive', 'category-comparison', 'geographic-snapshot']) assert.ok(!BUILT_IN_TEMPLATES.some(t => t.id === cut), cut);
  for (const tpl of BUILT_IN_TEMPLATES) {
    assert.equal(tpl.theme, 'paper', tpl.id);
    assert.ok(tpl.screenshot, `${tpl.id} has a bundled thumbnail`);
    assert.match(tpl.description, /\?$/, `${tpl.id} description states its question`);
  }
});

test('every built-in template validates as a layout with no overlapping tiles', () => {
  for (const tpl of BUILT_IN_TEMPLATES) {
    const layout = validateLayout({ app: 'dashboard-builder', version: 3, rowHeight: tpl.rowHeight, theme: tpl.theme, tiles: tpl.tiles });
    assert.equal(layout.tiles.length, tpl.tiles.length, tpl.id);
    for (const [i, a] of tpl.tiles.entries()) for (const b of tpl.tiles.slice(i + 1)) {
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${tpl.id}: "${a.title}" overlaps "${b.title}"`);
    }
    for (const t of tpl.tiles) {
      assert.ok(t.w >= 1 && t.x + t.w <= 12, `${tpl.id}: ${t.title} fits the grid`);
    }
    // One 1440×900 present-mode screen: 35 rows of 24px (840px of the 860px grid area).
    assert.equal(tpl.rowHeight, 24, `${tpl.id} uses 24px rows`);
    assert.ok(Math.max(...tpl.tiles.map(t => t.y + t.h)) <= 35, `${tpl.id} fits one 1440×900 screen`);
  }
});

test('every data tile references a registered Meridian dataset carrying its default-mapped fields', () => {
  for (const tpl of BUILT_IN_TEMPLATES) {
    for (const t of tpl.tiles) {
      const entry = TILE_TYPES[t.type];
      if (entry.noData) { assert.equal(t.dataset, undefined, `${tpl.id}: text tile has no dataset`); continue; }
      assert.ok(Object.hasOwn(DATASETS, t.dataset), `${tpl.id}: ${t.dataset} is registered`);
      assert.ok(Object.hasOwn(MERIDIAN_DATASETS, t.dataset), `${tpl.id}: ${t.dataset} is purpose-built, not the generic pool`);
      assert.ok(!CORE_DATASET_KEYS.includes(t.dataset), `${tpl.id}: ${t.dataset}`);
      const columns = new Set(DATASETS[t.dataset].flatMap(row => Object.keys(row)));
      for (const f of entry.fields.filter(f => !f.optional)) assert.ok(columns.has(f.key), `${tpl.id}: ${t.title} needs ${f.key} in ${t.dataset}`);
      assert.ok(entry.datasets.includes(t.dataset), `${tpl.id}: ${t.dataset} is offered in the ${t.type} picker`);
    }
  }
});

test('every template ends with an annotation carrying its source line', () => {
  for (const tpl of BUILT_IN_TEMPLATES) {
    const last = [...tpl.tiles].sort((a, b) => a.y - b.y || a.x - b.x).at(-1);
    assert.equal(last.type, 'text', tpl.id);
    assert.match(last.tileOptions.body, /Synthetic data/, `${tpl.id} names its data as synthetic`);
  }
});

test('every template tile renders in the export render path without a tile error', () => {
  for (const tpl of BUILT_IN_TEMPLATES) {
    for (const t of tpl.tiles) {
      const el = document.createElement('div');
      el.style.width = `${t.w * 100}px`; el.style.height = `${t.h * 24}px`;
      document.body.append(el);
      TILE_TYPES[t.type].render(el, { data: t.dataset ? DATASETS[t.dataset] : [], options: { title: t.title, tileOptions: t.tileOptions || {} } });
      assert.equal(el.querySelector('.tile-error'), null, `${tpl.id}: ${t.title}: ${el.querySelector('.tile-error')?.textContent}`);
      const ok = t.type === 'kpi' ? '.db-kpi-row' : t.type === 'table' ? '.db-data-table' : t.type === 'text' ? '.db-annotation' : 'svg';
      assert.ok(el.querySelector(ok), `${tpl.id}: ${t.title} rendered`);
      el.remove();
    }
  }
});

test('small multiples accept the sort option; "data" keeps time order, default stays largest-first', () => {
  const tiles = [{ type: 'smallMultiples', x: 0, y: 0, w: 12, h: 6, dataset: 'cocDaysByHousehold', tileOptions: { sort: 'data' } }];
  assert.equal(validateLayout({ app: 'dashboard-builder', version: 1, tiles }).tiles[0].tileOptions.sort, 'data');
  assert.throws(() => validateLayout({ app: 'dashboard-builder', version: 1, tiles: [{ ...tiles[0], tileOptions: { sort: 'sideways' } }] }), /Unsupported chart option/);
  const ticks = (tileOptions) => {
    const el = document.createElement('div'); el.style.width = '1200px'; el.style.height = '430px'; document.body.append(el);
    TILE_TYPES.smallMultiples.render(el, { data: DATASETS.cocDaysByHousehold, options: { title: 't', tileOptions } });
    const first = el.querySelector('svg');
    const labels = [...first.querySelectorAll('g[aria-label="x-axis tick label"] text')].map(n => n.textContent);
    el.remove();
    return labels;
  };
  assert.deepEqual(ticks({ sort: 'data' }), ['FY22', 'FY23', 'FY24', 'FY25', 'FY26']);
  assert.deepEqual(ticks({}).slice(0, 1), ['FY22']); // values fall each year, so largest-first starts at FY22
  assert.notDeepEqual(ticks({ sort: 'asc' }), ticks({ sort: 'data' }));
});

test('the seeded generator passes every plausibility anchor and reproduces the committed files byte-for-byte', () => {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'generate-sample-data.mjs'), '--check'], { encoding: 'utf8' });
  assert.doesNotMatch(out, /^FAIL|DRIFT/m, out);
  assert.match(out, /Checked 11 family files/);
});
