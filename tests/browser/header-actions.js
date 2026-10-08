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
