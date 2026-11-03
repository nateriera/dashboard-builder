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
