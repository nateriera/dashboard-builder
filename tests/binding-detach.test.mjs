import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Binding fix v1 (2026-11-27): one pure helper detaches parameter bindings
// whose filter is gone. G3 pins the helper; G4 pins the serialize guarantee
// (the same pruning serializeLayout applies to the emitted parameters).
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/' });
globalThis.document = dom.window.document; globalThis.window = dom.window;
for (const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','CustomEvent','getComputedStyle']) globalThis[key] = dom.window[key];
const { validateLayout } = await import('../src/data/layout.js');
const { detachMissingFilterBindings, isMissingFilterBindingError, validateParameterBindings } = await import('../src/data/parameterBindings.js');

const starter = JSON.parse(readFileSync(new URL('../src/data/starterDashboard.json', import.meta.url), 'utf8'));
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

const filter = (id, extra = {}) => ({ id, field: 'extra_exits', op: 'is', values: [0], scope: 'dashboard', ...extra });
const bound = (name, filterId, extra = {}) => ({ name, type: 'number', value: 20, min: 0, max: 40, bindings: [{ kind: 'filter', filterId }], ...extra });

// ── G3: helper units ─────────────────────────────────────────────────────
test('G3: a binding to a missing filter is detached; the parameter and its value survive', () => {
  const parameters = deepFreeze([bound('extra_exits', 'filter-extra-exits')]);
  const { parameters: next, detached } = detachMissingFilterBindings(parameters, []);
  assert.deepEqual(detached, ['extra_exits']);
  assert.deepEqual(next, [{ name: 'extra_exits', type: 'number', value: 20, min: 0, max: 40 }]);
  assert.equal(Object.hasOwn(next[0], 'bindings'), false, 'no empty bindings array is left behind');
  assert.deepEqual(parameters[0].bindings, [{ kind: 'filter', filterId: 'filter-extra-exits' }], 'input is not mutated');
});

test('G3: a live binding is untouched and the original array is returned', () => {
  const parameters = deepFreeze([bound('extra_exits', 'filter-extra-exits'), { name: 'note', type: 'text', value: 'x' }]);
  const result = detachMissingFilterBindings(parameters, [filter('filter-extra-exits')]);
  assert.deepEqual(result.detached, []);
  assert.equal(result.parameters, parameters);
});

test('G3: only dead bindings detach in a mixed set; values of every kind are preserved', () => {
  const range = { name: 'window', type: 'number-range', value: { from: 1, to: 9 }, bindings: [{ kind: 'filter', filterId: 'gone-range' }] };
  const parameters = deepFreeze([bound('live', 'f-live'), bound('dead', 'f-gone', { value: 40 }), range, { name: 'unbound', type: 'boolean', value: true }]);
  const { parameters: next, detached } = detachMissingFilterBindings(parameters, [filter('f-live')]);
  assert.deepEqual(detached, ['dead', 'window']);
  assert.equal(next[0], parameters[0], 'the live-bound parameter object is reused');
  assert.equal(next[1].value, 40);
  assert.deepEqual(next[2], { name: 'window', type: 'number-range', value: { from: 1, to: 9 } });
  assert.equal(next[3], parameters[3]);
});

test('G3: non-filter bindings are untouched, including beside a detached filter binding', () => {
  const other = { kind: 'query', queryId: 'q1' };
  const parameters = deepFreeze([
    { name: 'a', type: 'text', value: 'v', bindings: [other] },
    { name: 'b', type: 'text', value: 'w', bindings: [other, { kind: 'filter', filterId: 'missing' }] }
  ]);
  const { parameters: next, detached } = detachMissingFilterBindings(parameters, []);
  assert.deepEqual(detached, ['b']);
  assert.equal(next[0], parameters[0]);
  assert.deepEqual(next[1], { name: 'b', type: 'text', value: 'w', bindings: [other] });
});

test('G3: empty and absent inputs pass through', () => {
  const empty = [];
  assert.deepEqual(detachMissingFilterBindings(empty, []), { parameters: empty, detached: [] });
  assert.equal(detachMissingFilterBindings(empty, []).parameters, empty);
  assert.deepEqual(detachMissingFilterBindings(undefined, [filter('f')]), { parameters: undefined, detached: [] });
  const unbound = deepFreeze([{ name: 'n', type: 'number', value: 1 }]);
  assert.equal(detachMissingFilterBindings(unbound, undefined).parameters, unbound);
  const { detached } = detachMissingFilterBindings([bound('x', 'f')], undefined);
  assert.deepEqual(detached, ['x'], 'absent filters means no filter exists');
});

test('G3: the recovery matcher recognises exactly the missing-filter error', () => {
  const missing = (() => { try { validateParameterBindings([bound('extra_exits', 'filter-extra-exits')], []); } catch (error) { return error; } })();
  assert.equal(missing.message, 'Parameter extra_exits is bound to missing filter filter-extra-exits.');
  assert.equal(isMissingFilterBindingError(missing), true);
  const owners = (() => { try { validateParameterBindings([bound('a', 'f'), bound('b', 'f')], [filter('f')], () => [{ field: 'extra_exits', type: 'number', checkable: true, valueTypes: ['number'] }]); } catch (error) { return error; } })();
  assert.match(owners.message, /cannot both bind/);
  assert.equal(isMissingFilterBindingError(owners), false);
  assert.equal(isMissingFilterBindingError(new Error('Invalid filter binding for parameter x.')), false);
  assert.equal(isMissingFilterBindingError(undefined), false);
});

test('G3: the shared validator stays strict', () => {
  assert.throws(() => validateParameterBindings([bound('extra_exits', 'filter-extra-exits')], []), /bound to missing filter/);
});

// ── G4: serialize invariant ──────────────────────────────────────────────
// serializeLayout emits `parameters: detachMissingFilterBindings(parameters, filters).parameters`.
const emit = layout => ({ ...layout, parameters: detachMissingFilterBindings(layout.parameters, layout.filters).parameters });

test('G4: the starter with its filter deleted is unreadable raw, and validates clean once pruned', () => {
  const dangling = { ...structuredClone(starter), filters: [] };
  assert.throws(() => validateLayout(dangling), /Parameter extra_exits is bound to missing filter filter-extra-exits\./);
  const valid = validateLayout(emit(dangling));
  assert.deepEqual(valid.parameters, [{ name: 'extra_exits', type: 'number', value: 0, min: 0, max: 40, step: 10, integer: true }]);
});

test('G4: the cleared-page shape (no tiles, no filters, a bound parameter) validates clean once pruned', () => {
  const cleared = { ...structuredClone(starter), filters: [], tiles: [], parameters: [{ ...structuredClone(starter.parameters[0]), value: 30 }] };
  assert.throws(() => validateLayout(cleared), /bound to missing filter/);
  assert.equal(validateLayout(emit(cleared)).parameters[0].value, 30);
});

test('G4: pruning leaves a readable layout byte-identical in its parameters', () => {
  const live = structuredClone(starter);
  assert.equal(emit(live).parameters, live.parameters);
  assert.deepEqual(validateLayout(emit(live)).parameters, validateLayout(live).parameters);
});
