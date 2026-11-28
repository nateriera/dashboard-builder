import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { acceptImportConfirmation, configureImportContext } from './accept-import.js';
import { clickHeaderAction } from './header-actions.js';

// Binding fix v1 (2026-11-27). The launch-film shoot found the starter's
// extra_exits parameter left bound to filter-extra-exits after Clear current
// page; autosave then stored a layout the loader refused ("Saving is
// disabled") and desktop Save wrote an unimportable project. These specs walk
// that journey (G1) and the recovery of layouts v0.1.0 already saved (G2).
acceptImportConfirmation(test);

const KEY = 'dashboard-builder:layout:v1';
const DETACHED_ON_REMOVE = /Detached parameter bindings: extra_exits \(bound filter removed with the deleted tiles?\)\. The parameter and its value were kept\./;
const DETACHED_ON_READ = 'Detached parameter bindings: extra_exits (bound filter no longer exists). The parameter and its value were kept.';

async function dismissHint(page) {
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible().catch(() => false)) await hint.getByRole('button', { name: 'Got it' }).click();
}
async function freshStarter(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await dismissHint(page);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(5);
}
const starterJson = async page => page.evaluate(async () => structuredClone((await import('/src/data/starterDashboard.json')).default));
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
// The loader's own verdict on what is stored: null when readable, else the error.
const storedVerdict = page => page.evaluate(async key => {
  const { validateLayout } = await import('/src/data/layout.js');
  try { validateLayout(JSON.parse(localStorage.getItem(key))); return null; } catch (error) { return error.message; }
}, KEY);
async function expectHealthy(page) {
  await expect(page.locator('[data-corrupt-notice]')).toHaveCount(0);
  await expect(page.locator('#persistence-warning')).toBeHidden();
  await expect(page.locator('#status')).not.toContainText(/could not be read|Saving is disabled/);
}
async function expectSavingEnabled(page) {
  await clickHeaderAction(page, '#btn-save');
  await expect(page.locator('#status')).toContainText('Changes saved in this browser');
  await expect(page.locator('#persistence-warning')).toBeHidden();
}
async function parameterSlider(page) {
  await page.locator('#btn-filters').click();
  const popover = page.locator('.dashboard-filters-popover');
  await popover.getByRole('tab', { name: 'Parameters' }).click();
  return popover.getByLabel('Slider for extra_exits');
}
async function exportJson(page) {
  const downloading = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export');
  return JSON.parse(await fs.readFile(await (await downloading).path(), 'utf8'));
}
async function importLayout(page, layout, name = 'binding-fix.json') {
  await page.locator('#status').evaluate(node => { node.textContent = 'Reading binding fixture…'; });
  await page.locator('#file-import').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(layout)) });
  await expect(page.locator('#status')).toContainText(/Imported|Import failed/);
}
const unbound = value => ({ name: 'extra_exits', type: 'number', value, min: 0, max: 40, step: 10, integer: true });

// Reload, export, and re-import the result in a fresh profile: every step
// must read clean, with extra_exits present at `value` and unbound.
async function expectRoundTrip(page, browser, value) {
  await page.reload();
  await expect(page.locator('#status')).toContainText('Layout restored from this browser');
  await expect(page.locator('#status')).not.toContainText('Detached parameter bindings');
  await expectHealthy(page);
  await expectSavingEnabled(page);

  const exported = await exportJson(page);
  expect(exported.parameters).toEqual([unbound(value)]);
  expect(exported.filters).toEqual([]);

  const context = await browser.newContext(); await configureImportContext(context);
  try {
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(fresh.locator('#status')).toContainText('Starter dashboard loaded');
    await importLayout(fresh, exported, 'exported.json');
    await expect(fresh.locator('#status')).toContainText('Imported exported.json');
    await expect(fresh.locator('#status')).not.toContainText('Detached parameter bindings');
    expect((await stored(fresh)).parameters).toEqual([unbound(value)]);
    expect(await storedVerdict(fresh)).toBeNull();
    await expect(await parameterSlider(fresh)).toHaveValue(String(value));
  } finally { await context.close(); }
}

test('G1 journey: Clear current page on the starter detaches extra_exits, announces it, and every save stays readable', async ({ page, browser }) => {
  await freshStarter(page);
  page.once('dialog', dialog => dialog.accept());
  await clickHeaderAction(page, '#btn-clear');
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(0);

  // Surfaced at the moment of loss, and still there after the autosave lands.
  await expect(page.locator('#status')).toContainText(DETACHED_ON_REMOVE);
  await expect.poll(() => page.evaluate(() => document.getElementById('status').textContent)).toMatch(/^Changes saved in this browser · Detached parameter bindings: extra_exits/);
  await page.waitForTimeout(700);
  await expect(page.locator('#status')).toContainText(DETACHED_ON_REMOVE);

  // What was stored is readable and keeps the parameter.
  expect(await storedVerdict(page)).toBeNull();
  const saved = await stored(page);
  expect(saved.filters).toEqual([]);
  expect(saved.parameters).toEqual([unbound(0)]);

  // The app stays functional: the parameter is still editable, a tile can be added.
  await expect(await parameterSlider(page)).toHaveValue('0');
  await page.locator('#btn-filters').click();
  await page.locator('.palette-item[data-tile-type="text"]').click();
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('Changes saved in this browser');
  await expect(page.locator('#status')).not.toContainText('Detached parameter bindings');

  await expectRoundTrip(page, browser, 0);
});

test('G1 variant: deleting only the what-if tile detaches the binding, keeps the slider value, and round-trips clean', async ({ page, browser }) => {
  await freshStarter(page);
  const slider = await parameterSlider(page);
  await slider.evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(async () => (await stored(page))?.parameters?.[0]?.value).toBe(20);
  await page.locator('#btn-filters').click();

  const whatIf = page.locator('.grid-stack-item[gs-id="what-if"]');
  await whatIf.locator('.tile-remove').click();
  await whatIf.locator('.tile-remove-confirm .tpl-confirm-yes').click();
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(4);
  await expect(page.locator('#status')).toContainText('Detached parameter bindings: extra_exits (bound filter removed with the deleted tile). The parameter and its value were kept.');

  await expect.poll(() => storedVerdict(page)).toBeNull();
  await expect.poll(async () => (await stored(page)).filters).toEqual([]);
  expect((await stored(page)).parameters).toEqual([unbound(20)]);
  await expectHealthy(page);

  await expectRoundTrip(page, browser, 20);
});

test('G2 recovery: a stored layout v0.1.0 bricked (bound filter deleted) opens, says what was detached, keeps saving, and heals', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  const starter = await starterJson(page);
  const bricked = { ...starter, filters: [], parameters: [{ ...starter.parameters[0], value: 30 }] };
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(bricked)]);
  expect(await storedVerdict(page)).toBe('Parameter extra_exits is bound to missing filter filter-extra-exits.');

  await page.reload();
  await expect(page.locator('#status')).toContainText('Detached parameter bindings: extra_exits (bound filter no longer exists)');
  await expect(page.locator('#status')).toContainText(DETACHED_ON_READ);
  await expectHealthy(page);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(5);
  await expect(page.locator('.tile-error')).toHaveCount(0);

  // Healed on first load: the stored state is rewritten readable, value kept.
  await expect.poll(() => storedVerdict(page)).toBeNull();
  expect((await stored(page)).parameters).toEqual([unbound(30)]);
  await expectSavingEnabled(page);

  await page.reload();
  await expect(page.locator('#status')).toHaveText('Layout restored from this browser · Stored locally');
  await expectHealthy(page);
});

test('G2 recovery: importing a project file shaped like the shoot evidence succeeds with the detachment reported', async ({ page }) => {
  await freshStarter(page);
  const starter = await starterJson(page);
  // Same shape as test-project-meridian.overwritten-take1: no tiles, no filters, a bound parameter.
  const evidence = { app: 'dashboard-builder', version: 5, rowHeight: 24, savedAt: '2026-11-28T03:24:59.260Z',
    meta: { title: 'Meridian County homeless response', preparedBy: 'Dashboard Builder sample', dataPeriod: 'October 2023 – September 2026' },
    defaultDataset: starter.defaultDataset, filters: [], parameters: starter.parameters, savedViews: [],
    pages: starter.pages, currentPageId: starter.currentPageId, theme: 'paper', tiles: [], omittedDependencies: [] };
  await importLayout(page, evidence, 'test-project-meridian.json');
  await expect(page.locator('#status')).toHaveText(`Imported test-project-meridian.json · ${DETACHED_ON_READ}`);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(0);
  expect(await storedVerdict(page)).toBeNull();
  expect((await stored(page)).parameters).toEqual([unbound(0)]);
  await expectHealthy(page);
  await expectSavingEnabled(page);

  // The starter with only its filter deleted imports with all five tiles.
  await importLayout(page, { ...starter, filters: [] }, 'starter-no-filter.json');
  await expect(page.locator('#status')).toHaveText(`Imported starter-no-filter.json · ${DETACHED_ON_READ}`);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(5);
});

test('G2 control: a different validation failure (duplicate binding owners) still fails exactly as before', async ({ page }) => {
  await freshStarter(page);
  const starter = await starterJson(page);
  const duplicate = { ...starter, parameters: [...starter.parameters, { ...starter.parameters[0], name: 'extra_exits_copy' }] };
  const message = 'Parameters extra_exits and extra_exits_copy cannot both bind to filter filter-extra-exits.';
  expect(await page.evaluate(async layout => { try { (await import('/src/data/layout.js')).validateLayout(layout); return null; } catch (error) { return error.message; } }, duplicate)).toBe(message);

  // Import refuses it and leaves the current dashboard in place.
  await importLayout(page, duplicate, 'duplicate.json');
  await expect(page.locator('#status')).toHaveText(`Import failed: ${message}`);
  await expect(page.locator('.grid-stack > .grid-stack-item')).toHaveCount(5);

  // A stored copy still takes the unreadable-save path.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(duplicate)]);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Your saved dashboard could not be read');
  await expect(page.locator('[data-corrupt-notice]')).toHaveCount(1);
  await expect(page.locator('#status')).not.toContainText('Detached parameter bindings');
});

test('F1 audit: applying a saved view whose filters lack the bound filter detaches the binding and stays readable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  const starter = await starterJson(page);
  // A view saved before the parameter was bound: its filter snapshot is empty.
  const view = { id: 'view-before-binding', name: 'Before binding', theme: 'paper', currentPageId: starter.currentPageId, filters: [], parameters: [unbound(10)] };
  const layout = { ...starter, savedViews: [view] };
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, JSON.stringify(layout)]);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Layout restored from this browser');
  await dismissHint(page);

  await page.locator('#btn-saved-views').click();
  await page.locator('#saved-view-picker').selectOption(view.id);
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('#status')).toContainText('Applied saved view “Before binding”. · Detached parameter bindings: extra_exits (bound filter not in this saved view). The parameter and its value were kept.');
  await expect.poll(async () => (await stored(page)).parameters).toEqual([unbound(10)]);
  expect(await storedVerdict(page)).toBeNull();
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Layout restored from this browser · Stored locally');
  await expectHealthy(page);
});
