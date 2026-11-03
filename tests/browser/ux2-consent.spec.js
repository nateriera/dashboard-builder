import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

test('corrupt save is retained and offered for download while starter opens', async ({ page }) => {
  const key = 'dashboard-builder:layout:v1';
  const raw = '{broken save';
  await page.addInitScript(({key, raw}) => localStorage.setItem(key, raw), {key, raw});
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/could not be read/i);
  const notice = page.locator('[data-corrupt-notice]');
  await expect(notice).toContainText(/copy.*kept/i);
  await expect(page.locator('.tile').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await notice.getByRole('button', {name: /download/i}).click();
  expect(await fs.readFile(await (await download).path(), 'utf8')).toBe(raw);
  await clickHeaderAction(page, '#btn-save');
  expect(await page.evaluate((key) => Object.entries(localStorage).some(([k,v]) => k.startsWith(key + ':corrupt:') && v === '{broken save'), key)).toBe(true);
  await notice.getByRole('button', {name: /dismiss/i}).click();
  await expect(notice).toHaveCount(0);
});


test('import asks after validation and preserves every stored byte on cancellation', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await clickHeaderAction(page, '#btn-save');
  const before = await page.evaluate(() => JSON.stringify({...localStorage}));
  const fixture = {app:'dashboard-builder',version:1,tiles:[{id:'replacement',type:'text',title:'Replacement',x:0,y:0,w:6,h:4}]};
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
  await page.locator('#file-import').setInputFiles({name:'candidate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await expect.poll(() => message).toContain('replaces');
  expect(message).toMatch(/all pages/i);
  expect(message).toMatch(/recovery copy/i);
  expect(await page.evaluate(() => JSON.stringify({...localStorage}))).toBe(before);
  await expect(page.locator('[gs-id="replacement"]')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#file-import').setInputFiles({name:'candidate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await expect(page.locator('#status')).toContainText('Imported');
  await expect(page.locator('[gs-id="replacement"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dashboard-builder:layout:v1:recovery'))).toBeTruthy();
});

test('guided replacement confirms when only another page has tiles', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  page.once('dialog', dialog => dialog.accept('Empty page'));
  await page.getByRole('button', {name:'Add dashboard page'}).click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(0);
  await page.locator('#btn-data').click();
  await page.locator('.data-popover .data-drop input').setInputFiles({name:'metrics.csv',mimeType:'text/csv',buffer:Buffer.from('region,amount\nWest,12\nEast,20')});
  const guide = page.locator('.guided-dialog'); await expect(guide).toBeVisible();
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
  await guide.getByRole('button', {name:'Build selected charts'}).click();
  await expect.poll(() => message).toContain('Replace the current dashboard');
  await expect(guide).toBeVisible();
  await expect(page.locator('.grid-stack-item')).toHaveCount(0);
});

test('tile upload disables Apply while loading and never binds after dismissal', async ({page}) => {
  await page.route('**/src/ui/dataPopover.js', async route => {
    const response = await route.fetch(); let source = await response.text();
    source = source.replace('const { columns, rows } = await readUpload(file,pop);', 'await window.ux2Wait; const { columns, rows } = await readUpload(file,pop);');
    source = source.replace('const persisted = await persistDataset(id);', 'await window.ux2Wait; const persisted = await persistDataset(id); window.ux2Done = true;');
    await route.fulfill({response,body:source});
  });
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  const tile = page.locator('.grid-stack-item').first();
  const sourceBefore = await tile.locator('.tile-data-btn').textContent();
  await tile.locator('.tile-data-btn').click();
  const pop = page.locator('.data-popover');
  await pop.getByRole('button',{name:'Upload',exact:true}).click();
  const input = pop.locator('input[type=file]');
  const csv = {name:'values.csv',mimeType:'text/csv',buffer:Buffer.from('label,value\nWest,12\nEast,20')};
  await page.evaluate(() => { window.ux2Wait = new Promise(resolve => window.ux2Release = resolve); });
  await input.setInputFiles(csv);
  await expect(pop.getByRole('button',{name:'Apply to tile'})).toBeDisabled();
  await expect(pop).toContainText(/loading|reading/i);
  await pop.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(() => window.ux2Release());
  await expect(tile.locator('.tile-data-btn')).toHaveText(sourceBefore);
  await tile.locator('.tile-data-btn').click();
  await pop.getByRole('button',{name:'Upload',exact:true}).click();
  await input.setInputFiles(csv);
  await expect(pop.getByRole('button',{name:'Apply to tile'})).toBeEnabled();
  await page.evaluate(() => { window.ux2Wait = new Promise(resolve => window.ux2Release = resolve); });
  await pop.getByRole('button',{name:'Apply to tile'}).click();
  await expect(pop.getByRole('button',{name:/Applying/})).toBeDisabled();
  await pop.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(() => window.ux2Release());
  await expect.poll(() => page.evaluate(() => window.ux2Done)).toBe(true);
  await expect(tile.locator('.tile-data-btn')).toHaveText(sourceBefore);
});

test('dashboard upload rejection stays visible and preserves the previous dashboard data', async ({page}) => {
  await page.route('**/src/main.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('const persisted = await persistDataset(id);', 'await Promise.reject(new Error("Injected upload failure")); const persisted = await persistDataset(id);');
    await route.fulfill({response,body:source});
  });
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  const original = await page.locator('#btn-data').textContent();
  await page.locator('#btn-data').click();
  const pop = page.getByRole('dialog',{name:'Dashboard data'});
  await pop.getByLabel('Paste tabular data').fill('region\tvalue\nWest\t12');
  await pop.getByRole('button',{name:'Import pasted data'}).click();
  await expect(pop.locator('.data-error')).toContainText('Injected upload failure');
  await expect(page.locator('#status')).toContainText('Injected upload failure');
  await expect(page.locator('.guided-dialog')).toHaveCount(0);
  await expect(page.locator('#btn-data')).toHaveText(original);
});

test('removing a tile names it and respects cancel and confirm', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  const tile = page.locator('.grid-stack-item').first();
  const title = await tile.locator('.tile-title').inputValue();
  const count = await page.locator('.grid-stack-item').count();
  await tile.locator('.tile-remove').click();
  const confirmation = tile.locator('.tile-remove-confirm');
  await expect(confirmation).toContainText(title);
  await expect(confirmation.getByRole('button',{name:'Cancel'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.grid-stack-item')).toHaveCount(count);
  await tile.locator('.tile-remove').click();
  await confirmation.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(count - 1);
});

test('clear current page preserves other pages and storage across reload', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  page.once('dialog', dialog => dialog.accept('Detail'));
  await page.getByRole('button',{name:'Add dashboard page'}).click();
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await clickHeaderAction(page, '#btn-save');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')));
  let prompt = '';
  page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await clickHeaderAction(page, '#btn-clear');
  expect(prompt).toMatch(/current page/i);
  await expect(page.locator('.grid-stack-item')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await clickHeaderAction(page, '#btn-clear');
  await expect(page.locator('.grid-stack-item')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).tiles.filter(t => t.pageId === JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).currentPageId).length)).toBe(0);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')));
  expect(after.pages).toEqual(before.pages);
  expect(after.savedViews).toEqual(before.savedViews);
  expect(after.defaultDataset).toEqual(before.defaultDataset);
  expect(after.tiles.filter(t => t.pageId !== after.currentPageId)).toEqual(before.tiles.filter(t => t.pageId !== before.currentPageId));
  await page.reload();
  await expect(page.getByRole('tab',{name:'Detail'})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.grid-stack-item')).toHaveCount(0);
  await page.getByRole('tab',{name:'Page 1'}).click();
  await expect(page.locator('.grid-stack-item')).toHaveCount(before.tiles.filter(t => t.pageId !== before.currentPageId).length);
});
