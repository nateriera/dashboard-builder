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

