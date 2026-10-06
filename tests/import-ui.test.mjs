import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
for (const key of ['Node', 'Element', 'HTMLElement', 'SVGElement', 'NodeList', 'HTMLCollection', 'MutationObserver', 'getComputedStyle']) globalThis[key] = dom.window[key];
const { toggleDataPopover, closeDataPopover } = await import('../src/ui/dataPopover.js');
const { toggleDashboardPopover, closeDashboardPopover } = await import('../src/ui/dashboardDataPopover.js');

test('upload tab imports pasted TSV via existing preview and tile apply workflow', async () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  let applied;
  toggleDataPopover({ anchor, type: 'table', meta: { dataset: null }, dashboard: null, onSample() {}, onUpload(value) { applied = value; }, onQuery() {}, onDashboard() {} });
  document.querySelector('.data-tab:nth-child(2)').click();
  const paste = document.querySelector('[aria-label="Paste tabular data"]');
  paste.value = 'Name\tValue\nA\t12';
  document.querySelectorAll('.data-import-source-button')[1].click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.match(document.querySelector('.data-filename').textContent, /Pasted table — 1 rows, 2 columns/);
  assert.equal(document.querySelector('.data-preview tbody td').textContent, 'A');
  document.querySelector('.data-apply').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(applied && applied.id);
  closeDataPopover();
});

test('dashboard data popover imports pasted tabular content as its default dataset', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  let imported;
  toggleDashboardPopover({ anchor, current: { kind: 'samples' }, sampleKeys: [], onSelect() {}, onUpload(value) { imported = value; } });
  const paste = document.querySelector('[aria-label="Paste tabular data"]');
  paste.value = 'Region\tAmount\nWest\t15';
  document.querySelectorAll('.data-import-source-button')[1].click();
  assert.equal(imported.name, 'Pasted table');
  assert.deepEqual(imported.columns, ['Region', 'Amount']);
  assert.deepEqual(imported.rows, [{ Region: 'West', Amount: '15' }]);
  closeDashboardPopover();
});

test('dashboard data popover supplies a profile when importing a CSV URL', async () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  let imported;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Region,Amount\nWest,15', { headers: { 'content-type': 'text/csv' } });
  try {
    toggleDashboardPopover({ anchor, current: { kind: 'samples' }, sampleKeys: [], onSelect() {}, onUpload(value) { imported = value; } });
    document.querySelector('[aria-label="Public CSV URL"]').value = 'https://example.com/data.csv';
    document.querySelectorAll('.data-import-source-button')[0].click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(imported.profile.fields.map((field) => field.kind), ['category', 'number']);
  } finally {
    globalThis.fetch = originalFetch;
    closeDashboardPopover();
  }
});
