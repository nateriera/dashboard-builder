import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
}

test('filters popover enters, escapes and restores focus to its trigger', async ({page}) => {
  await ready(page);
  const trigger=page.locator('#btn-filters');
  await trigger.click();
  const pop=page.getByRole('dialog',{name:'Dashboard filters and parameters'});
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button',{name:'Close filters and parameters'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('dashboard data popover follows a moving anchor', async ({page}) => {
  await ready(page);
  const anchor=page.locator('#btn-data');
  await anchor.click();
  const pop=page.getByRole('dialog',{name:'Dashboard data'});
  await expect(pop).toBeVisible();
  await pop.evaluate(node => { node.style.height='220px'; node.style.overflow='auto'; });
  await expect.poll(async () => {
    const box=await pop.boundingBox(); const anchorBox=await anchor.boundingBox();
    return Math.abs(box.y-anchorBox.y-anchorBox.height-6);
  }).toBeLessThanOrEqual(2);
  await page.evaluate(() => {
    const button=document.querySelector('#btn-data');
    button.style.transform='translateY(90px)';
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:100,clientY:100}));
  });
  await expect.poll(async () => {
    const box=await pop.boundingBox(); const anchorBox=await anchor.boundingBox();
    return Math.abs(box.y-anchorBox.y-anchorBox.height-6);
  }).toBeLessThanOrEqual(2);
});

test('present mode closes editor popovers, hides page navigation and restores focus on exit', async ({page}) => {
  await ready(page);
  await page.locator('#btn-filters').click();
  await expect(page.getByRole('dialog',{name:'Dashboard filters and parameters'})).toBeVisible();
  const trigger=page.locator('#btn-present');
  await trigger.click();
  await expect(page.getByRole('dialog',{name:'Dashboard filters and parameters'})).toHaveCount(0);
  await expect(page.locator('#page-tabs')).toBeHidden();
  await expect(page.locator('#btn-add-page')).toBeHidden();
  await expect(page.locator('.grid-stack')).toBeFocused();
  const exit=page.locator('#btn-exit-present');
  await expect(exit).toBeVisible();
  await exit.focus(); await expect(exit).toBeFocused();
  await exit.click();
  await expect(page.locator('#page-tabs')).toBeVisible();
  await expect(page.locator('.header-more > summary')).toBeFocused();
});
