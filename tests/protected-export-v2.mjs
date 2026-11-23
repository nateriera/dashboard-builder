// Protected HTML export v2 (§8.1): minimization, envelope, and the §1
// choropleth sample fix. Run with the same loader as the other node tests:
//   node --no-warnings --loader ./tests/json-loader.mjs --test tests/protected-export-v2.mjs
// Every test is deterministic: fixed passwords, fixed AAD overrides where a
// test supplies one; randomness is asserted by property, not by value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import {
  projectExportRows, EXPORT_ROW_EXTRAS, exportRowKeys, projectBackupDataset,
  normalizeRows, guessMapping
} from '../src/tiles/normalize.js';
import {
  encryptPayload, decryptPayload, isEncryptedPayload, validatePassword,
  ENVELOPE_VERSION, KDF_ITERATIONS, AAD
} from '../src/export/protect.js';
import { chartData } from '../src/ui/chartData.js';
import { retainSourceRows, sourceRowsFor } from '../src/data/rowProvenance.js';

const ROOT = new URL('..', import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8'));

// Registry entries mirrored from src/tiles/registry.js (fields only — the
// helper derives its allowlist from these, so this table pins §5.1).
const ENTRIES = {
  bar: { fields: [{ key: 'label' }, { key: 'value', numeric: true }] },
  column: { fields: [{ key: 'label' }, { key: 'value', numeric: true }] },
  line: { fields: [{ key: 'date' }, { key: 'value', numeric: true }, { key: 'series', optional: true }] },
  scatter: { fields: [{ key: 'x', numeric: true }, { key: 'y', numeric: true }, { key: 'group', optional: true }] },
  dot: { fields: [{ key: 'label' }, { key: 'value', numeric: true }] },
  donut: { fields: [{ key: 'label' }, { key: 'value', numeric: true }] },
  choropleth: { fields: [{ key: 'id' }, { key: 'value', numeric: true }] },
  smallMultiples: { fields: [{ key: 'facet' }, { key: 'label' }, { key: 'value', numeric: true }] },
  kpi: { fields: [{ key: 'label' }, { key: 'value' }, { key: 'delta', optional: true }, { key: 'deltaDir', optional: true }] },
  table: { fields: [], dynamicFields: true },
  text: { fields: [], noData: true },
  stackedBar: { fields: [{ key: 'label' }, { key: 'value', numeric: true }, { key: 'series' }] },
  stackedColumn: { fields: [{ key: 'label' }, { key: 'value', numeric: true }, { key: 'series' }] },
  histogram: { fields: [{ key: 'value', numeric: true }] },
  boxplot: { fields: [{ key: 'label' }, { key: 'value', numeric: true }] },
  area: { fields: [{ key: 'date' }, { key: 'value', numeric: true }, { key: 'series', optional: true }] },
  heatmap: { fields: [{ key: 'x' }, { key: 'y' }, { key: 'value', numeric: true }] },
  treemap: { fields: [{ key: 'label' }, { key: 'value', numeric: true }, { key: 'parent', optional: true }] }
};

const ALLOWLIST = {
  bar: ['label', 'value'], column: ['label', 'value'],
  line: ['date', 'value', 'series'], area: ['date', 'value', 'series'],
  scatter: ['x', 'y', 'group'], dot: ['label', 'value'],
  donut: ['label', 'value'], choropleth: ['id', 'value'],
  smallMultiples: ['facet', 'label', 'value'],
  stackedBar: ['label', 'value', 'series'], stackedColumn: ['label', 'value', 'series'],
  histogram: ['value', 'x', 'y', 'start', 'end', 'key'],
  boxplot: ['label', 'value'], heatmap: ['x', 'y', 'value'],
  treemap: ['label', 'value', 'parent'],
  kpi: ['label', 'value', 'delta', 'deltaDir', 'invert']
};

const sampleRow = (keys) => {
  const row = {};
  for (const key of keys) row[key] = key === 'value' || key === 'x' || key === 'y' ? 7 : `v-${key}`;
  row.junk1 = 'drop me'; row.junk2 = 42; row.junk3 = null;
  return row;
};

test('§8.1.1 per-type projection keeps exactly the allowlist (§5.1)', () => {
  for (const [type, entry] of Object.entries(ENTRIES)) {
    if (type === 'table' || type === 'text') continue;
    const extras = EXPORT_ROW_EXTRAS[type] || [];
    const out = projectExportRows(entry, [sampleRow(ALLOWLIST[type])], extras);
    assert.deepEqual(Object.keys(out[0]).sort(), [...ALLOWLIST[type]].sort(), type);
  }
});

test('§8.1.1 filter-target fields ride along as extraKeys', () => {
  const out = projectExportRows(ENTRIES.bar, [{ label: 'A', value: 3, Region: 'North', junk: 1 }], ['Region']);
  assert.deepEqual(out, [{ label: 'A', value: 3, Region: 'North' }]);
});

test('§8.1.1 Meridian sample rows project idempotently', () => {
  const coc = load('src/data/meridian/coc.json');
  assert.deepEqual(
    projectExportRows(ENTRIES.kpi, coc.cocKpis, EXPORT_ROW_EXTRAS.kpi), coc.cocKpis);
  assert.deepEqual(
    projectExportRows(ENTRIES.smallMultiples, coc.cocDaysByHousehold, []), coc.cocDaysByHousehold);
  const cs311 = load('src/data/meridian/cs311.json');
  assert.deepEqual(
    projectExportRows(ENTRIES.line, cs311.cs311Daily, []), cs311.cs311Daily);
});

test('§8.1.2 KPI invert is preserved; a row without it gains none', () => {
  const withInvert = projectExportRows(ENTRIES.kpi,
    [{ label: 'Cost', value: '$9', delta: '-2%', deltaDir: 'down', invert: true, secret: 1 }],
    EXPORT_ROW_EXTRAS.kpi);
  assert.deepEqual(withInvert, [{ label: 'Cost', value: '$9', delta: '-2%', deltaDir: 'down', invert: true }]);
  const without = projectExportRows(ENTRIES.kpi,
    [{ label: 'Cost', value: '$9', delta: '-2%', deltaDir: 'down' }], EXPORT_ROW_EXTRAS.kpi);
  assert.equal('invert' in without[0], false);
});

test('§8.1.3 donut: no truncation — 8 rows stay 8 rows (§5.3)', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ label: `Cat ${i}`, value: i + 1, junk: i }));
  const out = projectExportRows(ENTRIES.donut, rows, []);
  assert.equal(out.length, 8);
  assert.deepEqual(out.map((r) => r.value), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('§8.1.4 histogram keeps pre-binned keys and the x/y fallbacks', () => {
  const preBinned = projectExportRows(ENTRIES.histogram,
    [{ start: 0, end: 10, value: 5, key: 'a', junk: 1 }], EXPORT_ROW_EXTRAS.histogram);
  assert.deepEqual(preBinned, [{ start: 0, end: 10, value: 5, key: 'a' }]);
  const plain = projectExportRows(ENTRIES.histogram,
    [{ x: 1, y: 2, value: 9, junk: 1 }], EXPORT_ROW_EXTRAS.histogram);
  assert.deepEqual(plain, [{ x: 1, y: 2, value: 9 }]);
});

test('§8.1.5 table is exempt (copied whole); text has no rows', () => {
  const rows = [{ a: 1, b: 2, c: 3 }];
  const out = projectExportRows(ENTRIES.table, rows, []);
  assert.deepEqual(out, rows);
  assert.notEqual(out[0], rows[0]); // a copy, not the stored object
  assert.deepEqual(projectExportRows(ENTRIES.text, rows, []), []);
  assert.equal(exportRowKeys(ENTRIES.table), null);
});

test('§8.1.6 choropleth sample fix: 51 of 56 topology features have values', () => {
  const states = load('src/data/states.json');
  const topo = load('src/data/us-states-10m.json');
  assert.equal(states.length, 51);
  assert.ok(states.every((row) => !('fips' in row) && !('state' in row)));
  assert.ok(states.every((row) => Object.keys(row).sort().join() === 'id,value'));
  const values = new Map(states.map((d) => [String(d.id), d.value]));
  const features = topo.objects.states.geometries;
  assert.equal(features.length, 56);
  const withValue = features.filter((f) => values.has(String(f.id)));
  assert.equal(withValue.length, 51);
  const topoIds = new Set(features.map((f) => String(f.id)));
  assert.ok(states.every((row) => topoIds.has(String(row.id))));
  // The five topology-only ids are territories with no sample data.
  assert.deepEqual([...topoIds].filter((id) => !values.has(id)).sort(), ['60', '66', '69', '72', '78']);
});

test('§8.1.7 with no source rows retained, the disclosure shows the projected rows', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const original = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const projected = projectExportRows(ENTRIES.bar,
      [{ label: 'A', value: 3, Region: 'North', Secret: 's1' }], []);
    // readPayload links rows to sourceRows only when sourceRows is an array;
    // a minimized export omits the key, so nothing is retained.
    retainSourceRows(projected, undefined);
    assert.equal(sourceRowsFor(projected), projected);
    const details = chartData(projected, [{ key: 'label' }, { key: 'value' }], 'Chart');
    document.body.append(details);
    details.open = true;
    details.dispatchEvent(new dom.window.Event('toggle'));
    assert.deepEqual(
      [...details.querySelectorAll('thead button')].map((b) => b.textContent),
      ['label', 'value']);
    assert.deepEqual(
      [...details.querySelectorAll('tbody td')].map((c) => c.textContent), ['A', '3']);
  } finally {
    globalThis.document = original;
    dom.window.close();
  }
});

const BAR = { fields: [{ key: 'label', label: 'Label column' }, { key: 'value', label: 'Value column', numeric: true }] };
const SCATTER = { fields: [{ key: 'x', label: 'X column', numeric: true }, { key: 'y', label: 'Y column', numeric: true }, { key: 'group', label: 'Group column', optional: true }] };
const fieldsForType = (type) => ({ bar: BAR, scatter: SCATTER, table: ENTRIES.table }[type]);

function backupFixture() {
  return {
    name: 'upload.csv',
    columns: ['Category', 'Amount', 'Region', 'Secret'],
    rows: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }],
    fieldKeys: ['label', 'value'],
    mapping: { label: 'Category', value: 'Amount' },
    raw: {
      columns: ['Category', 'Amount', 'Region', 'Secret'],
      rows: [
        { Category: 'A', Amount: 10, Region: 'North', Secret: 's1' },
        { Category: 'B', Amount: 20, Region: 'South', Secret: 's2' }
      ]
    }
  };
}

test('§8.1.8 backup projection: union allowlist, raw mapped columns, dropped column gone', () => {
  const tiles = [
    { type: 'bar', id: 't1', pageId: 'p1' },
    { type: 'scatter', id: 't2', pageId: 'p1' }
  ];
  const filterFields = (tileId) => (tileId === 't1' ? ['Region'] : []);
  const out = projectBackupDataset(backupFixture(), tiles, fieldsForType, filterFields, true);
  // rows: normalized bar rows keep label/value (scatter keys are absent here).
  assert.deepEqual(out.rows, [{ label: 'A', value: 10 }, { label: 'B', value: 20 }]);
  // raw: mapped source columns + the filter-target field; Secret is gone.
  assert.deepEqual(out.raw.rows, [
    { Category: 'A', Amount: 10, Region: 'North' },
    { Category: 'B', Amount: 20, Region: 'South' }
  ]);
  assert.deepEqual(out.raw.columns, ['Category', 'Amount', 'Region']);
  assert.deepEqual(out.columns, ['Category', 'Amount', 'Region']);
  assert.deepEqual(out.fieldKeys, ['label', 'value']);
  assert.deepEqual(out.mapping, { label: 'Category', value: 'Amount' });
  // Re-import renders identically: re-normalizing the projected raw rows
  // for the bar tile gives the same rows as the unprojected dataset did.
  const before = normalizeRows(BAR, backupFixture().raw.rows, { label: 'Category', value: 'Amount' }).rows;
  const after = normalizeRows(BAR, out.raw.rows, out.mapping).rows;
  assert.deepEqual(after, before);
});

test('§8.1.8 backup projection: dashboard-default datasets (raw rows) and table exemption', () => {
  const rawDataset = {
    name: 'dash.csv',
    columns: ['Category', 'Amount', 'Secret'],
    rows: [
      { Category: 'A', Amount: 10, Secret: 's1' },
      { Category: 'B', Amount: 20, Secret: 's2' }
    ],
    fieldKeys: [],
    mapping: {},
    raw: {
      columns: ['Category', 'Amount', 'Secret'],
      rows: [
        { Category: 'A', Amount: 10, Secret: 's1' },
        { Category: 'B', Amount: 20, Secret: 's2' }
      ]
    }
  };
  const out = projectBackupDataset(rawDataset,
    [{ type: 'bar', id: 't1', pageId: 'p1' }], fieldsForType, () => [], true);
  assert.deepEqual(out.rows, [{ Category: 'A', Amount: 10 }, { Category: 'B', Amount: 20 }]);
  assert.deepEqual(out.raw.columns, ['Category', 'Amount']);

  const tableFixture = backupFixture();
  const tabled = projectBackupDataset(tableFixture,
    [{ type: 'table', id: 't9', pageId: 'p1' }], fieldsForType, () => [], true);
  assert.equal(tabled, tableFixture); // exempt: returned unchanged
  assert.deepEqual(tabled.rows, tableFixture.rows);
  assert.deepEqual(tabled.raw.rows, tableFixture.raw.rows);
});

test('§8.1.9 JSON export lossless: minimize:false returns the dataset unchanged', () => {
  const fixture = backupFixture();
  const out = projectBackupDataset(fixture, [], fieldsForType, () => [], false);
  assert.equal(out, fixture);
  assert.equal(JSON.stringify(out), JSON.stringify(fixture));
});

const PASSWORD = 'correct-horse-battery-staple';
const PAYLOAD = JSON.stringify({ app: 'dashboard-builder', version: 5, tiles: [{ id: 't1', type: 'bar', rows: [{ label: 'A', value: 1 }] }] });

test('§8.1.10 envelope round-trip is byte-identical; salt/IV/ciphertext vary', async () => {
  const a = await encryptPayload(PAYLOAD, PASSWORD);
  assert.equal(a.version, ENVELOPE_VERSION);
  assert.equal(a.encrypted, true);
  assert.equal(a.kdf.iterations, KDF_ITERATIONS);
  assert.equal(a.kdf.hash, 'SHA-256');
  assert.equal(await decryptPayload(a, PASSWORD), PAYLOAD);
  const b = await encryptPayload(PAYLOAD, PASSWORD);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test('§8.1.11 wrong password and tampering fail closed', async () => {
  const envelope = await encryptPayload(PAYLOAD, PASSWORD);
  await assert.rejects(decryptPayload(envelope, 'wrong-password-1234'));
  const flip = (b64) => (b64[0] === 'A' ? 'B' : 'A') + b64.slice(1);
  for (const field of ['data']) {
    const tampered = { ...envelope, [field]: flip(envelope[field]) };
    await assert.rejects(decryptPayload(tampered, PASSWORD), field);
  }
  await assert.rejects(decryptPayload({ ...envelope, cipher: { ...envelope.cipher, iv: flip(envelope.cipher.iv) } }, PASSWORD), 'iv');
  await assert.rejects(decryptPayload({ ...envelope, kdf: { ...envelope.kdf, salt: flip(envelope.kdf.salt) } }, PASSWORD), 'salt');
  // Wrong AAD: encrypted under a different AAD must not decrypt under the real one.
  const otherAad = await encryptPayload(PAYLOAD, PASSWORD, 'dashboard-builder:other');
  await assert.rejects(decryptPayload(otherAad, PASSWORD));
  await assert.rejects(decryptPayload({ data: '!!!' }, PASSWORD));
});

test('§8.1.12 no-plaintext-leak: the envelope carries no sentinel or label', async () => {
  const sentinel = `PROTECTED_EXPORT_SENTINEL_${randomBytes(8).toString('hex')}`;
  const payload = JSON.stringify({ version: 5, tiles: [{ id: 't1', type: 'bar', rows: [{ label: sentinel, value: 1 }] }] });
  const envelope = await encryptPayload(payload, PASSWORD);
  const text = JSON.stringify(envelope);
  assert.equal(text.includes(sentinel), false);
  assert.equal(text.includes('PROTECTED_EXPORT_SENTINEL'), false);
  assert.equal(text.includes('bar'), false);
});

test('§8.1.13 password rules: 12 minimum, confirm must match', () => {
  assert.match(validatePassword('short', 'short'), /at least 12/);
  assert.match(validatePassword('long-enough-password', 'different-password'), /do not match/);
  assert.equal(validatePassword('exactly-12!!', 'exactly-12!!'), null);
  assert.equal(validatePassword('long-enough-password', 'long-enough-password'), null);
  assert.equal(AAD, 'dashboard-builder:v6');
});

test('§8.1.14 plaintext v5 and v1 payloads are recognized as unencrypted', () => {
  const v5 = { app: 'dashboard-builder', version: 5, kind: 'dashboard-export', tiles: [] };
  const v1 = { app: 'dashboard-builder', version: 1, kind: 'dashboard-export', tiles: [] };
  assert.equal(isEncryptedPayload(v5), false);
  assert.equal(isEncryptedPayload(v1), false);
  assert.equal(isEncryptedPayload(null), false);
  assert.equal(isEncryptedPayload({ encrypted: true }), false);
});
