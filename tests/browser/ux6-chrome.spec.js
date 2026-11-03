import { test, expect } from '@playwright/test';

const emptyLayout = {
  app: 'dashboard-builder', version: 5, rowHeight: 24, theme: 'paper',
  pages: [{ id: 'page-1', name: 'Page 1' }], currentPageId: 'page-1', tiles: [],
  savedViews: [{ id: 'view-slate', name: 'Slate view', theme: 'slate', currentPageId: 'page-1', filters: [], parameters: [] }]
};

async function startEmpty(page) {
  page.on('pageerror', error => console.log('BROWSER_PAGE_ERROR', error.stack || error.message));
  await page.addInitScript(layout => localStorage.setItem('dashboard-builder:layout:v1', JSON.stringify(layout)), emptyLayout);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Layout restored from this browser · Stored locally');
}

test('saved views popover explains saved state, selects without applying, escapes and restores focus', async ({ page }) => {
  await startEmpty(page);
  const trigger = page.locator('#btn-saved-views');
  await trigger.click();
  const popover = page.getByRole('dialog');
  await expect(popover.getByRole('heading', { name: 'Saved views' })).toBeVisible();
  await expect(popover).toContainText('Save the current filters, parameters, and theme to return to later.');
  const apply = popover.getByRole('button', { name: 'Apply selected view' });
  await expect(apply).toBeDisabled();
  await popover.getByLabel('Choose a saved view').selectOption('view-slate');
  await expect(apply).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('#saved-view-picker').selectOption('view-slate');
  await page.locator('#btn-apply-view').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'slate');
});

test('empty page shows measured grid guidance, Add chart focuses palette, and first tile hides guidance', async ({ page }) => {
  await startEmpty(page);
  await expect(page.locator('#grid-guidance')).toBeVisible();
  const guideCount = await page.locator('.grid-cell-guides span').count();
  expect(guideCount).toBeGreaterThan(0);
  expect(guideCount % 12).toBe(0);
  await page.locator('#btn-grid-add-chart').click();
  await expect(page.locator('.palette-item').first()).toBeFocused();
  await page.locator('.palette-item').first().click();
  await expect(page.locator('#grid-guidance')).toBeHidden();
  await expect(page.locator('.grid-stack')).not.toHaveClass(/show-grid-guides/);
});

test('palette guidance dismissal persists and returns from More actions', async ({ page }) => {
  await startEmpty(page);
  await expect(page.locator('#palette-guidance')).toBeVisible();
  await page.locator('#btn-hide-guidance').click();
  await expect(page.locator('#palette-guidance')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('dashboard-builder:palette-guidance-dismissed:v1'))).toBe('1');
  await page.locator('.header-more > summary').click();
  await expect(page.locator('#btn-show-guidance')).toBeVisible();
  await page.locator('#btn-show-guidance').click();
  await expect(page.locator('#palette-guidance')).toBeVisible();
  await page.reload();
  await expect(page.locator('#palette-guidance')).toBeVisible();
});

test('tile data source label keeps a long dataset name without ellipsis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const label = page.locator('.tile-data-label').first();
  const longName = `${'Long dataset name '.repeat(12)} (27 rows)`;
  await label.evaluate((node, value) => { node.textContent = value; }, longName);
  await expect(label).toHaveText(longName);
  await expect(label).toHaveCSS('text-overflow', 'clip');
  await expect(label).toHaveCSS('overflow-wrap', 'anywhere');
});

test('intermediate widths move actions into More and collapse the palette into a modal', async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await expect(page.locator('#btn-add-chart')).toBeVisible();
  await expect(page.locator('#palette')).toBeHidden();
  const menu = page.locator('.header-more-menu');
  await page.locator('.header-more > summary').click();
  await expect(menu.locator('#btn-data')).toBeVisible();
  await expect(menu.locator('#btn-filters')).toBeVisible();
  await expect(menu.locator('#btn-present')).toBeVisible();
  const actionOrder = await menu.locator('.header-responsive-actions button').evaluateAll(nodes => nodes.map(node => node.id));
  expect(actionOrder).toEqual(['btn-data', 'btn-filters', 'btn-present']);
  await page.locator('#btn-add-chart').click();
  await expect(page.getByRole('dialog', { name: 'Choose a chart' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Choose a chart' }).locator('.palette-item').first().click();
  await expect(page.getByRole('dialog', { name: 'Choose a chart' })).toHaveCount(0);
  await expect(page.locator('.grid-stack-item')).toHaveCount(6);
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('#btn-add-chart')).toBeHidden();
  await expect(page.locator('#btn-data')).toHaveCount(1);
  await expect.poll(() => page.locator('#btn-data').evaluate(node => !!node.closest('.header-responsive-actions'))).toBe(false);
});
