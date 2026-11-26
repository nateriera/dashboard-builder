// Mythos fix slice v1 (Nov 26, 2026): acceptance tests for the three
// findings of the Mythos 5.2 adversarial review of main @ 23006b4.
//   F1 (G1/G2) — an HTML export inlines only the uploads something consumes,
//                and only the columns that consumer displays or names.
//   F2 (G3)    — the app's DuckDB connection has no external access and a
//                locked configuration.
//   F3 (G4)    — digit-led dollar-quote tags no longer hide a second
//                statement from prepareStatement.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import { shareHtml } from './header-actions.js';
import { configureImportContext, acceptImportConfirmation, acceptExportSnapshotConfirmation } from './accept-import.js';

// §0.2 fixture: two rows, four columns, sentinel values in every cell.
const SECRET_NAME = 'mythos-secret.csv';
const SECRET_COLUMNS = ['slabel', 'sregion', 'svalue', 'sextra'];
const SECRET_CSV = 'slabel,sregion,svalue,sextra\nSentinelLabelA,SentinelRegionA,918273,SentinelExtraA\nSentinelLabelB,SentinelRegionB,564738,SentinelExtraB';
const SECRET_VALUES = ['SentinelLabelA', 'SentinelLabelB', 'SentinelRegionA', 'SentinelRegionB', '918273', '564738', 'SentinelExtraA', 'SentinelExtraB'];
// A second upload that no query reads (the "others exist" half of §1).
const OTHER_NAME = 'mythos-other.csv';
const OTHER_COLUMNS = ['olabel', 'oregion', 'ovalue'];
const OTHER_CSV = 'olabel,oregion,ovalue\nOtherLabelA,OtherRegionA,771942\nOtherLabelB,OtherRegionB,665283';
const OTHER_VALUES = ['OtherLabelA', 'OtherLabelB', 'OtherRegionA', 'OtherRegionB', '771942', '665283'];
const NEEDLES = ['mythos-secret', 'mythos-other', ...SECRET_COLUMNS, ...SECRET_VALUES, ...OTHER_COLUMNS, ...OTHER_VALUES];

const payloadOf = (html) => JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

async function emptyDashboard(page) {
  await ready(page);
  await page.locator('#file-import').setInputFiles({ name: 'mythos-empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'dashboard-builder', version: 1, tiles: [] })) });
  await expect(page.locator('#status')).toContainText('Imported');
}

// Returns a locator pinned to the new tile's grid id, so it stays on that
// tile when other tiles are removed.
async function addTile(page, type) {
  const before = await page.locator('.tile').count();
  await page.locator(`.palette-item[data-tile-type="${type}"]`).click();
  await expect(page.locator('.tile')).toHaveCount(before + 1);
  const id = await page.locator('.grid-stack-item').nth(before).getAttribute('gs-id');
  return page.locator(`.grid-stack-item[gs-id="${id}"] .tile`);
}

// Upload a CSV to a table tile and apply it (the §0.2 first step).
async function uploadToTable(page, tile, name, csv, columns) {
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  await pop.getByRole('button', { name: 'Upload', exact: true }).click();
  await pop.locator('.data-drop input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(pop.locator('.data-filename')).toContainText(`2 rows, ${columns} columns`);
  await pop.locator('.data-panel:visible').getByRole('button', { name: 'Apply to tile', exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(tile.locator('.db-data-table tbody tr')).toHaveCount(2);
}

// Re-point a tile through the SQL panel: Run, then Apply.
async function applySql(page, tile, sql, rows) {
  await tile.locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  await expect(page.locator('.data-sql-run')).toBeEnabled({ timeout: 90000 });
  await page.locator('.data-sql-input').fill(sql);
  await page.locator('.data-sql-run').click();
  await expect(page.locator('.data-sql-status')).toHaveText(`${rows} row${rows === 1 ? '' : 's'}`, { timeout: 90000 });
  await page.locator('.data-panel:visible .data-apply').click();
  await expect(page.locator('.data-popover')).toHaveCount(0);
}

async function uploadIdNamed(page, name) {
  return page.evaluate(async (name) => (await import('/src/data/store.js')).listDatasets().find((ds) => ds.name === name).id, name);
}

async function exportHtml(page) {
  const downloading = page.waitForEvent('download');
  await shareHtml(page);
  return fs.readFile(await (await downloading).path(), 'utf8');
}

// Every needle is checked against the viewer template first, so a hit can
// only come from the exported dashboard data.
let templateText = null;
async function expectAbsentFromTemplate(page, needles) {
  templateText ??= await page.evaluate(async () => await (await fetch('/export-template.html')).text());
  for (const needle of needles) expect(templateText, `template already contains ${JSON.stringify(needle)}`).not.toContain(needle);
}

function expectAbsent(html, needles) {
  for (const needle of needles) expect(html, `exported HTML must not contain ${JSON.stringify(needle)}`).not.toContain(needle);
}

acceptImportConfirmation(test);
acceptExportSnapshotConfirmation(test);

test('G1: a table tile re-pointed from an upload to a built-in query exports none of the upload', async ({ page }) => {
  test.setTimeout(150000);
  await emptyDashboard(page);
  const tile = await addTile(page, 'table');
  await uploadToTable(page, tile, SECRET_NAME, SECRET_CSV, 4);
  await applySql(page, tile, 'SELECT label, value FROM categorical', 8);
  await expect(tile.locator('.db-data-table')).not.toContainText('SentinelLabelA');
  const html = await exportHtml(page);
  const payload = payloadOf(html);
  expect(payload.layout.datasets).toBeUndefined();
  await expectAbsentFromTemplate(page, NEEDLES);
  expectAbsent(html, ['mythos-secret', ...SECRET_COLUMNS, ...SECRET_VALUES]);
});

test('G1: a query saved before the fix (stored dependencies list every upload) still exports none of an unread upload', async ({ page }) => {
  test.setTimeout(150000);
  await emptyDashboard(page);
  const tile = await addTile(page, 'table');
  await uploadToTable(page, tile, SECRET_NAME, SECRET_CSV, 4);
  const id = await uploadIdNamed(page, SECRET_NAME);
  // The pre-fix Apply handler stored every upload as a dependency. Seed that
  // record shape directly and bind the tile to it through a layout import
  // that keeps the store (uploads and queries persist across the import).
  const qid = await page.evaluate(async (id) => (await import('/src/data/queries.js')).saveQuery({
    sql: 'SELECT label, value FROM categorical', columns: ['label', 'value'], fieldKeys: ['label', 'value'], mapping: {}, dependencies: [`upload:${id}`]
  }).id, id);
  await page.locator('#file-import').setInputFiles({ name: 'legacy-query.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'dashboard-builder', version: 1, tiles: [{ id: 'legacy', type: 'table', dataset: `query:${qid}`, x: 0, y: 0, w: 8, h: 10 }] })) });
  await expect(page.locator('#status')).toContainText('Imported');
  expect(await page.evaluate(async (qid) => (await import('/src/data/queries.js')).getQuery(qid).dependencies, qid)).toEqual([`upload:${id}`]);
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(8);
  const html = await exportHtml(page);
  expect(payloadOf(html).layout.datasets).toBeUndefined();
  await expectAbsentFromTemplate(page, NEEDLES);
  expectAbsent(html, ['mythos-secret', ...SECRET_COLUMNS, ...SECRET_VALUES]);
});

// Re-import the shared file in a fresh browser context, review the imported
// query (Run, then Apply — the imported-query contract), and return the page.
async function reimport(browser, html, tileId) {
  const context = await browser.newContext();
  await configureImportContext(context);
  const imported = await context.newPage();
  await ready(imported);
  await imported.locator('#file-import').setInputFiles({ name: 'mythos-shared.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(imported.locator('#status')).toContainText('Imported');
  const tile = imported.locator(`.grid-stack-item[gs-id="${tileId}"]`);
  await tile.getByRole('button', { name: 'Review query', exact: true }).click();
  await expect(imported.locator('.data-sql-run')).toBeEnabled({ timeout: 90000 });
  await imported.locator('.data-sql-run').click();
  await expect(imported.locator('.data-sql-status')).toHaveText('2 rows', { timeout: 90000 });
  await imported.locator('.data-panel:visible .data-apply').click();
  return { context, imported, tile };
}

test('G2: a table tile whose query selects one column of an upload exports only that column, and re-imports', async ({ page, browser }) => {
  test.setTimeout(180000);
  await emptyDashboard(page);
  const tile = await addTile(page, 'table');
  await uploadToTable(page, tile, SECRET_NAME, SECRET_CSV, 4);
  const id = await uploadIdNamed(page, SECRET_NAME);
  await applySql(page, tile, `SELECT slabel FROM upload_${id}`, 2);
  await expect(tile.locator('.db-data-table')).toContainText('SentinelLabelA');
  const tileId = await tile.evaluate((el) => el.closest('.grid-stack-item').getAttribute('gs-id'));
  const html = await exportHtml(page);
  const dataset = payloadOf(html).layout.datasets[id];
  // I3: the consumer is a table tile, but it reaches the upload only through
  // its query, so the upload is projected onto the column the SQL names.
  expect(dataset.columns).toEqual(['slabel']);
  expect(dataset.rows).toEqual([{ slabel: 'SentinelLabelA' }, { slabel: 'SentinelLabelB' }]);
  await expectAbsentFromTemplate(page, NEEDLES);
  expectAbsent(html, ['sregion', 'svalue', 'sextra', 'SentinelRegionA', 'SentinelRegionB', '918273', '564738', 'SentinelExtraA', 'SentinelExtraB']);
  const { context, tile: importedTile } = await reimport(browser, html, tileId);
  try {
    await expect(importedTile.locator('.db-data-table tbody tr')).toHaveCount(2);
    await expect(importedTile.locator('.db-data-table')).toContainText('SentinelLabelA');
    await expect(importedTile.locator('.db-data-table')).toContainText('SentinelLabelB');
  } finally { await context.close(); }
});

test('G2: a non-table SQL tile reading one upload while another exists exports only the columns it names, and re-imports', async ({ page, browser }) => {
  test.setTimeout(180000);
  await emptyDashboard(page);
  // Two uploads reach the store through table tiles that are then re-pointed
  // to built-in data, so neither is bound directly any more.
  const holderA = await addTile(page, 'table');
  await uploadToTable(page, holderA, SECRET_NAME, SECRET_CSV, 4);
  await applySql(page, holderA, 'SELECT label, value FROM categorical', 8);
  const holderB = await addTile(page, 'table');
  await uploadToTable(page, holderB, OTHER_NAME, OTHER_CSV, 3);
  await applySql(page, holderB, 'SELECT label, value FROM categorical', 8);
  const id = await uploadIdNamed(page, SECRET_NAME);
  const bar = await addTile(page, 'bar');
  await applySql(page, bar, `SELECT slabel AS label, svalue AS value FROM upload_${id}`, 2);
  await expect(bar.locator('.tile-chart svg')).toBeVisible();
  const barId = await bar.evaluate((el) => el.closest('.grid-stack-item').getAttribute('gs-id'));
  // Remove the holders: the bar is then the only tile, and both uploads stay
  // in the store (tile removal prunes queries, never uploads).
  for (const holder of [holderA, holderB]) {
    await holder.locator('.tile-remove').click();
    await holder.locator('.tile-remove-confirm .tpl-confirm-yes').click();
  }
  await expect(page.locator('.tile')).toHaveCount(1);
  expect(await page.evaluate(async () => (await import('/src/data/store.js')).listDatasets().length)).toBe(2);
  const html = await exportHtml(page);
  const datasets = payloadOf(html).layout.datasets;
  expect(Object.keys(datasets)).toEqual([id]);
  expect(datasets[id].columns).toEqual(['slabel', 'svalue']);
  // Table-tile uploads keep the parsed CSV text as-is.
  expect(datasets[id].rows).toEqual([{ slabel: 'SentinelLabelA', svalue: '918273' }, { slabel: 'SentinelLabelB', svalue: '564738' }]);
  await expectAbsentFromTemplate(page, NEEDLES);
  expectAbsent(html, ['sregion', 'sextra', 'SentinelRegionA', 'SentinelRegionB', 'SentinelExtraA', 'SentinelExtraB', 'mythos-other', ...OTHER_COLUMNS, ...OTHER_VALUES]);
  const { context, tile: importedBar } = await reimport(browser, html, barId);
  try {
    await expect(importedBar.locator('.tile-chart svg')).toBeVisible();
    await expect(importedBar.locator('.tile-chart')).toContainText('SentinelLabelA');
    await expect(importedBar.locator('.tile-filter-status, .tile-error')).toHaveCount(0);
  } finally { await context.close(); }
});

test('G3: the app connection refuses URL reads and extension autoload, and its configuration is locked', async ({ page, context }) => {
  test.setTimeout(120000);
  // Every way out is observable and would succeed if attempted: a local
  // HTTP server that counts its requests (the private-host case the import
  // path blocks), and context routes that answer the https:// URL and the
  // DuckDB extension repository. DuckDB-WASM's MVP build surfaces every
  // engine exception as "_setThrew is not defined", so refusal is shown by
  // the failure plus the absence of any outbound request, not by message.
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.setHeader('Access-Control-Allow-Origin', '*'); res.end('a,b\n1,2\n'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const outbound = [];
  await context.route(/^https:\/\/(example\.com|extensions\.duckdb\.org)\//, (route) => {
    outbound.push(route.request().url());
    return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'a,b\n1,2\n' });
  });
  page.on('request', (request) => { if (!new URL(request.url()).origin.startsWith('http://127.0.0.1:4')) outbound.push(request.url()); });
  try {
    await ready(page);
    const results = await page.evaluate(async (port) => {
      const { runQuery } = await import('/src/data/duckdb.js');
      const attempt = async (sql) => {
        try { const r = await runQuery(sql); return { ok: true, rows: r.rows }; } catch (err) { return { ok: false, message: String(err && err.message || err) }; }
      };
      return {
        local: await attempt(`SELECT * FROM read_csv_auto('http://127.0.0.1:${port}/probe.csv')`),
        remote: await attempt(`SELECT * FROM read_csv_auto('https://example.com/probe.csv')`),
        parquet: await attempt(`SELECT * FROM read_parquet('probe.parquet')`),
        json: await attempt(`SELECT json_extract('{"a":1}', '$.a') AS a`),
        settings: await attempt(`SELECT current_setting('enable_external_access') AS external, current_setting('lock_configuration') AS locked`),
        healthy: await attempt('SELECT label, value FROM categorical LIMIT 1')
      };
    }, port);
    for (const key of ['local', 'remote', 'parquet', 'json']) expect(results[key].ok, `${key}: ${JSON.stringify(results[key])}`).toBe(false);
    expect(hits, 'requests reaching the local server').toBe(0);
    expect(outbound, 'outbound requests (URL reads or extension downloads)').toEqual([]);
    expect(results.settings).toEqual({ ok: true, rows: [{ external: false, locked: true }] });
    // The refusals leave the connection usable.
    expect(results.healthy.ok, JSON.stringify(results.healthy)).toBe(true);
  } finally { server.close(); }
});

test('G4: digit-led dollar-quote tags no longer hide a second statement; legitimate dollar quoting still parses', async ({ page }) => {
  await ready(page);
  const out = await page.evaluate(async () => {
    const { prepareStatement } = await import('/src/data/sqlStatement.js');
    const attempt = (sql) => { try { return { ok: true, sql: prepareStatement(sql) }; } catch (err) { return { ok: false, message: err.message }; } };
    return {
      payload: attempt('SELECT $1$ AS a; SET VARIABLE x = 1; SELECT $1$ AS b'),
      anonymous: attempt('SELECT $$a; b$$ AS a'),
      tagged: attempt('SELECT $tag$a; b$tag$ AS a'),
      underscore: attempt('SELECT $_t1$a; b$_t1$ AS a')
    };
  });
  expect(out.payload).toEqual({ ok: false, message: 'Queries must be a single statement.' });
  expect(out.anonymous).toEqual({ ok: true, sql: 'SELECT $$a; b$$ AS a' });
  expect(out.tagged).toEqual({ ok: true, sql: 'SELECT $tag$a; b$tag$ AS a' });
  expect(out.underscore).toEqual({ ok: true, sql: 'SELECT $_t1$a; b$_t1$ AS a' });
});
