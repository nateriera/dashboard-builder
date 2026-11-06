import { test, expect } from '@playwright/test';

// F-SHARE-1 (P-1): two live focusDialog traps used to re-enter each other's
// document focusin handler until "Maximum call stack size exceeded".
//
// TRIGGER NOTE — these tests do NOT model a mouse or touch path. A real
// pointer click on Share (or on Saved views) raises pointerdown first, and the
// Saved views outside-close (main.js) / Share backdrop closes the other surface
// before the click lands, so pointer users cannot stack this pair; keyboard
// users are trapped inside whichever is open. The only trigger that exists is
// an activation without pointerdown (element.click() here; possibly some
// assistive-tech activations), so the specs use a scripted click on purpose.
// What they guard is the shared invariant: any two live traps must not recurse.

async function start(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  return errors;
}

const scriptedClick = (page, selector) => page.locator(selector).evaluate(button => button.click());

test('F-SHARE-1: Share as HTML opened over Saved views traps focus without recursion and Escape unwinds both', async ({ page }) => {
  const errors = await start(page);
  await page.locator('#btn-saved-views').click();
  await expect(page.locator('.saved-views-popover')).toBeVisible();
  await scriptedClick(page, '#btn-export-html');
  const share = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(share).toBeVisible();
  expect(errors).toEqual([]);
  await expect(share.getByLabel('Dashboard title')).toBeFocused();
  // Tab still wraps first <-> last inside the top trap only.
  await page.keyboard.press('Shift+Tab');
  await expect(share.getByRole('button', { name: 'Download dashboard HTML' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(share.getByLabel('Dashboard title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  // The still-open Saved views popover is the active trap again.
  await expect(page.locator('#saved-view-picker')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.saved-views-popover')).toHaveCount(0);
  await expect(page.locator('#btn-saved-views')).toBeFocused();
  expect(errors).toEqual([]);
});

test('F-SHARE-1: Saved views opened over Share as HTML (reverse order) unwinds without recursion', async ({ page }) => {
  const errors = await start(page);
  await page.locator('#btn-export-html').click();
  const share = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(share.getByLabel('Dashboard title')).toBeFocused();
  await scriptedClick(page, '#btn-saved-views');
  await expect(page.locator('.saved-views-popover')).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator('#saved-view-picker')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.saved-views-popover')).toHaveCount(0);
  await expect(share.getByLabel('Dashboard title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await expect(page.locator('#btn-export-html')).toBeFocused();
  expect(errors).toEqual([]);
});
