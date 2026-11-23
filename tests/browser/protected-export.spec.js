// Protected HTML export v2 (§8.2): share-modal password flow, envelope,
// unlock screen, and minimized-export parity. The upload fixture mirrors
// tests/browser/source-records.spec.js: a bar tile bound to a CSV whose
// label column maps from `region`, so the merged rows carry the unmapped
// `label` and `extra` columns that minimization must drop.
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { shareHtml, clickHeaderAction } from './header-actions.js';
import { seedMeridianServicesStarter } from './meridian-services-starter.js';
import { acceptImportConfirmation } from './accept-import.js';
import { encryptPayload } from '../../src/export/protect.js';

const PASSWORD = 'correct-horse-battery-staple';
const sourceCsv = 'label,region,value,extra\nOriginal A,Mapped A,12,Keep A\nOriginal B,Mapped B,7,Keep B';
// Values that live only in unmapped source columns: they must never appear
// in an exported file, plain or protected.
const SENTINELS = ['Original A', 'Original B', 'Keep A', 'Keep B'];

const payloadOf = (html) => JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);

async function template(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  return page.evaluate(async () => await (await fetch('/export-template.html')).text());
}

const viewerHtml = (html, payload) => html.replace('__DASHBOARD_PAYLOAD__', () => JSON.stringify({ app: 'dashboard-builder', version: 5, kind: 'dashboard-export', theme: 'paper', parameters: [], frozenParameters: [], exportedAt: '2026-11-03T14:05:09.000Z', exportedAtOffset: -300, ...payload }).replace(/</g, '\\u003c'));

// setContent pages are about:blank, which is not a secure context, so
// crypto.subtle is unavailable there. Serve the viewer HTML over the dev
// server's localhost origin instead — the same origin the real export is
// downloaded from — so WebCrypto works exactly as it does for a real file.
async function openViewer(page, html) {
  await page.route('**/protected-export-viewer.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('/protected-export-viewer.html');
  await page.unroute('**/protected-export-viewer.html');
}

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

async function emptyDashboard(page) {
  await ready(page);
  await page.locator('#file-import').setInputFiles({ name: 'protected-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'dashboard-builder', version: 1, tiles: [] })) });
  await expect(page.locator('#status')).toContainText('Imported');
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await expect(page.locator('.tile')).toHaveCount(1);
  return page.locator('.tile');
}

async function bindUpload(page, tile) {
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  await pop.getByRole('button', { name: 'Upload', exact: true }).click();
  await pop.locator('.data-drop input').setInputFiles({ name: 'protected-export.csv', mimeType: 'text/csv', buffer: Buffer.from(sourceCsv) });
  await expect(pop.locator('.data-filename')).toContainText('2 rows, 4 columns');
  const panel = pop.locator('.data-panel:visible');
  await panel.locator('.data-mapping select[data-field-key="label"]').selectOption('region');
  await panel.locator('.data-mapping select[data-field-key="value"]').selectOption('value');
  await panel.getByRole('button', { name: 'Apply to tile', exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(tile.locator('.tile-chart svg')).toBeVisible();
}

// A dashboard whose only tile is a bar chart over the upload above.
async function uploadDashboard(page) {
  const tile = await emptyDashboard(page);
  await bindUpload(page, tile);
  return tile;
}

async function downloadPlain(page) {
  const downloading = page.waitForEvent('download');
  await shareHtml(page);
  return fs.readFile(await (await downloading).path(), 'utf8');
}

async function downloadProtected(page, password = PASSWORD) {
  const downloading = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export-html');
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Protect with password').check();
  await dialog.getByLabel('Password (at least 12 characters)').fill(password);
  await dialog.getByLabel('Confirm password').fill(password);
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  return fs.readFile(await (await downloading).path(), 'utf8');
}

async function disclosureHeaders(tile) {
  const details = tile.locator('.chart-data:not(.chart-drillthrough)');
  await details.locator('summary').click();
  await expect(details.locator('tbody tr')).toHaveCount(2);
  return details.evaluate((node) =>
    [...node.querySelectorAll('thead th')].map((cell) => cell.querySelector('button').getAttribute('aria-label').slice('Sort by '.length)));
}

test('Modal: password fields appear with the checkbox; short or mismatched passwords block the download', async ({ page }) => {
  test.setTimeout(120000);
  await seedMeridianServicesStarter(page);
  await template(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await clickHeaderAction(page, '#btn-export-html');
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Protect with password').check();
  await expect(dialog.getByLabel('Password (at least 12 characters)')).toBeVisible();
  await expect(dialog.getByLabel('Confirm password')).toBeVisible();

  await dialog.getByLabel('Password (at least 12 characters)').fill('short');
  await dialog.getByLabel('Confirm password').fill('short');
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/at least 12 characters/);
  expect(downloads).toBe(0);

  await dialog.getByLabel('Password (at least 12 characters)').fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill('a-different-password-1');
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/do not match/);
  expect(downloads).toBe(0);

  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.screenshot({ path: 'test-results/protected-export-share-modal.png' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('Protected download carries no plaintext sentinel and is a v6 envelope', async ({ page }) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const html = await downloadProtected(page);
  for (const sentinel of [...SENTINELS, 'Mapped A', 'Mapped B']) {
    expect(html, `sentinel ${sentinel} must not appear`).not.toContain(sentinel);
  }
  const envelope = payloadOf(html);
  expect(envelope.encrypted).toBe(true);
  expect(envelope.version).toBe(6);
  expect(envelope.kind).toBe('dashboard-export');
  expect(typeof envelope.data).toBe('string');
});

test('Protected file shows only the unlock screen until unlocked', async ({ page, context }) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const html = await downloadProtected(page);
  const viewer = await context.newPage();
  await openViewer(viewer, html);
  await expect(viewer.locator('.export-unlock')).toBeVisible();
  await expect(viewer).toHaveTitle('Dashboard');
  await expect(viewer.locator('.export-head')).toHaveCount(0);
  await expect(viewer.locator('.export-tile')).toHaveCount(0);
  await expect(viewer.locator('.export-tile svg')).toHaveCount(0);
  await viewer.locator('.export-unlock').screenshot({ path: 'test-results/protected-export-unlock.png' });
});

test('Wrong password shows the generic error and renders nothing', async ({ page, context }) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const html = await downloadProtected(page);
  const viewer = await context.newPage();
  await openViewer(viewer, html);
  await viewer.getByLabel('Password').fill('wrong-password-1234');
  await viewer.getByRole('button', { name: 'Unlock' }).click();
  await expect(viewer.getByRole('alert')).toHaveText('Wrong password. Try again.');
  await expect(viewer.locator('.export-tile')).toHaveCount(0);
  await expect(viewer.locator('.export-head')).toHaveCount(0);
});

test('Right password renders the same dashboard as the plain export', async ({ page, context }) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const plainHtml = await downloadPlain(page);
  const protectedHtml = await downloadProtected(page);

  const plain = await context.newPage();
  await openViewer(plain, plainHtml);
  await expect(plain.locator('.export-tile svg')).toHaveCount(1);
  const plainHeaders = await disclosureHeaders(plain.locator('.export-tile'));

  const unlocked = await context.newPage();
  await openViewer(unlocked, protectedHtml);
  await unlocked.getByLabel('Password').fill(PASSWORD);
  await unlocked.getByRole('button', { name: 'Unlock' }).click();
  await expect(unlocked.locator('.export-tile svg')).toHaveCount(1);
  const unlockedHeaders = await disclosureHeaders(unlocked.locator('.export-tile'));
  expect(unlockedHeaders).toEqual(plainHeaders);
  expect(unlockedHeaders).toEqual(['label', 'value']);
});

test('Plaintext v5 export still opens with no unlock screen', async ({ page, context }) => {
  const html = await template(page);
  const payload = {
    tiles: [{ id: 'a', type: 'bar', title: 'Chart a', source: 'Intake log', x: 0, y: 0, w: 6, h: 15, crossfilterField: 'label',
      rows: [{ label: 'Housing', value: 12 }, { label: 'Food', value: 8 }, { label: 'Health', value: 5 }] }]
  };
  const viewer = await context.newPage();
  await openViewer(viewer, viewerHtml(html, payload));
  await expect(viewer.locator('.export-unlock')).toHaveCount(0);
  await expect(viewer.locator('.export-tile svg')).toHaveCount(1);
  await expect(viewer.locator('.export-head h1')).toHaveText('Untitled dashboard');
});

test('Minimized plain export: payload rows and disclosure show only the allowlist', async ({ page, context }) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const html = await downloadPlain(page);
  for (const sentinel of SENTINELS) expect(html, `sentinel ${sentinel} must not appear`).not.toContain(sentinel);
  const payload = payloadOf(html);
  expect(payload.tiles).toHaveLength(1);
  expect(payload.tiles[0]).not.toHaveProperty('sourceRows');
  expect(payload.tiles[0].rows).toEqual([
    { label: 'Mapped A', value: 12 },
    { label: 'Mapped B', value: 7 }
  ]);
  // The layout backup is projected too: the inlined raw rows lose the
  // unmapped columns, while the mapped source column survives.
  const datasets = Object.values(payload.layout.datasets || {});
  expect(datasets).toHaveLength(1);
  expect(datasets[0].raw.rows).toEqual([
    { region: 'Mapped A', value: '12' },
    { region: 'Mapped B', value: '7' }
  ]);

  const viewer = await context.newPage();
  await openViewer(viewer, html);
  await expect(viewer.locator('.export-tile svg')).toHaveCount(1);
  expect(await disclosureHeaders(viewer.locator('.export-tile'))).toEqual(['label', 'value']);
});

test('file:// plain and protected exports open', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await uploadDashboard(page);
  const plainHtml = await downloadPlain(page);
  const protectedHtml = await downloadProtected(page);
  const dir = testInfo.outputDir;
  await fs.mkdir(dir, { recursive: true });
  const plainPath = `${dir}/plain-dashboard.html`;
  const protectedPath = `${dir}/protected-dashboard.html`;
  await fs.writeFile(plainPath, plainHtml);
  await fs.writeFile(protectedPath, protectedHtml);

  const plain = await context.newPage();
  await plain.goto(`file://${plainPath}`);
  await expect(plain.locator('.export-tile svg')).toHaveCount(1);

  const locked = await context.newPage();
  await locked.goto(`file://${protectedPath}`);
  await expect(locked.locator('.export-unlock')).toBeVisible();
  await locked.getByLabel('Password').fill(PASSWORD);
  await locked.getByRole('button', { name: 'Unlock' }).click();
  await expect(locked.locator('.export-tile svg')).toHaveCount(1);
});

test('Envelope built in node opens in the viewer and decrypts', async ({ page, context }) => {
  const html = await template(page);
  const plaintext = JSON.stringify({
    app: 'dashboard-builder', version: 5, kind: 'dashboard-export', theme: 'paper',
    parameters: [], frozenParameters: [], exportedAt: '2026-11-03T14:05:09.000Z', exportedAtOffset: -300,
    tiles: [{ id: 'a', type: 'bar', title: 'Chart a', source: '', x: 0, y: 0, w: 6, h: 15, crossfilterField: 'label',
      rows: [{ label: 'Housing', value: 12 }] }]
  });
  const envelope = await encryptPayload(plaintext, PASSWORD);
  const viewer = await context.newPage();
  await openViewer(viewer, viewerHtml(html, envelope));
  await expect(viewer.locator('.export-unlock')).toBeVisible();
  await viewer.getByLabel('Password').fill(PASSWORD);
  await viewer.getByRole('button', { name: 'Unlock' }).click();
  await expect(viewer.locator('.export-tile svg')).toHaveCount(1);
  await expect(viewer.locator('.export-head h1')).toHaveText('Untitled dashboard');
});

acceptImportConfirmation(test);
