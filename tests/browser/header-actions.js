import { expect } from '@playwright/test';

export async function revealHeaderAction(page, selector) {
  const action = page.locator(selector);
  if (await action.isVisible()) return action;
  await page.locator('.header-more > summary').click();
  await expect(action).toBeVisible();
  return action;
}

export async function clickHeaderAction(page, selector) {
  const action = await revealHeaderAction(page, selector);
  await action.click();
}

export async function focusHeaderAction(page, selector) {
  const action = await revealHeaderAction(page, selector);
  await action.focus();
}

// UX-7 V1: Share as HTML opens the metadata modal first; Download continues
// into the existing export flow (its confirmations still follow).
export async function shareHtml(page, meta = {}) {
  await clickHeaderAction(page, '#btn-export-html');
  const dialog = page.getByRole('dialog', { name: 'Share as HTML' });
  await expect(dialog).toBeVisible();
  for (const [label, value] of Object.entries(meta)) await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Download dashboard HTML' }).click();
}
