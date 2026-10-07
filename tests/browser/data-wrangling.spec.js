import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await page.locator('.tile').filter({ hasText: 'Requests by category' }).locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await expect(page.locator('.wrangling-popover')).toBeVisible();
}

test('visual wrangling pivot runs detailed DuckDB preview, maps output and saves derived query', async ({ page }) => {
  test.setTimeout(120000);
  await ready(page);
  const pop = page.locator('.wrangling-popover');
  await expect(pop.locator('[aria-label="Grouping 1 column"]')).toBeVisible({ timeout: 90000 });
  await expect(pop.locator('[aria-label="Aggregation 1 operation"]')).toHaveValue('SUM');
  await pop.getByRole('button', { name: 'Add aggregation' }).click();
  await pop.getByLabel('Aggregation 2 source column').selectOption('value');
  await pop.getByLabel('Aggregation 2 operation').selectOption('AVG');
  await pop.getByLabel('Aggregation 2 output name').fill('Average total');
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  await expect(pop.locator('.data-preview-note').last()).toContainText('derived query');
  await expect(pop.locator('.data-preview tbody tr').first()).toBeVisible();
  await expect(pop.getByLabel('Output Label column').first()).toHaveValue('label');
  await expect(pop.getByLabel('Output Value column').first()).toHaveValue('Sum of value');
  await pop.getByRole('button', { name: 'Apply derived query to tile' }).click();
  await expect(page.locator('.wrangling-popover')).toHaveCount(0);
  await expect(page.locator('.tile').filter({ hasText: 'Requests by category' }).locator('.tile-chart svg')).toBeVisible({ timeout: 90000 });
  const queries = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dashbuilder.queries.v1') || '{"items":{}}').items));
  expect(queries.some(query => query.sql.includes('AVG("value") AS "Average total"'))).toBe(true);
});

test('desktop parity: reusable wrangling recipes save and restore pivot steps', async ({ page }) => {
  test.setTimeout(120000);
  await ready(page);
  const pop=page.locator('.wrangling-popover');
  await expect(pop.locator('[aria-label="Grouping 1 column"]')).toBeVisible({timeout:90000});
  await pop.getByLabel('Pivot recipe name').fill('Category totals');
  await pop.getByRole('button',{name:'Save recipe'}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dashbuilder.wrangling-recipes.v1')||'[]').length)).toBe(1);
  await pop.locator('[aria-label="Grouping 1 column"]').selectOption('value');
  await pop.locator('[aria-label="Pivot recipe"]').selectOption({label:'Category totals'});
  await pop.getByRole('button',{name:'Load recipe'}).click();
  await expect(pop.locator('[aria-label="Grouping 1 column"]')).toHaveValue('label');
  await expect(pop.locator('[aria-label="Aggregation 1 source column"]')).toHaveValue('value');
  await pop.getByRole('button',{name:'Preview pivot'}).click();
  await expect(pop.locator('.data-preview thead').last()).toContainText('label');
});

test('calculated-field entry opens formula panel, validates formula and applies derived field', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await page.locator('.tile').filter({ hasText: 'Requests by category' }).locator('.tile-data-btn').click();
  await page.getByRole('button', { name: 'Calculated field', exact: true }).click();
  const pop = page.locator('.wrangling-popover');
  await expect(pop.getByLabel('Calculated field formula')).toBeVisible({ timeout: 90000 });
  await expect(pop.locator('.data-tab.active')).toHaveText('Calculated field');
  await pop.getByLabel('Calculated field name').fill('Doubled value');
  await pop.getByLabel('Calculated field formula').fill('"value" * 2');
  await pop.getByRole('button', { name: 'Preview formula' }).click();
  await expect(pop.locator('.data-preview-note').last()).toContainText('derived query');
  await expect(pop.locator('.data-preview thead').last()).toContainText('Doubled value');
  await pop.getByRole('button', { name: 'Apply derived query to tile' }).click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('.tile').filter({ hasText: 'Requests by category' }).locator('.tile-chart svg')).toBeVisible({ timeout: 90000 });
  const queries = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dashbuilder.queries.v1') || '{"items":{}}').items));
  expect(queries.some(query => query.sql.includes('"Doubled value"') && query.sql.includes('"value" * 2'))).toBe(true);
});

test('unmapped required chart fields keep Apply disabled and invalid formula shows DuckDB feedback', async ({ page }) => {
  test.setTimeout(120000);
  await ready(page);
  const pop = page.locator('.wrangling-popover');
  await expect(pop.locator('[aria-label="Grouping 1 column"]')).toBeVisible({ timeout: 90000 });
  await pop.locator('[aria-label="Grouping 1 column"]').selectOption('value');
  await pop.locator('[aria-label="Aggregation 1 output name"]').fill('Count');
  await pop.locator('[aria-label="Aggregation 1 operation"]').selectOption('COUNT');
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  await expect(pop.getByRole('button', { name: 'Apply derived query to tile' })).toBeDisabled();
  await pop.getByLabel('Output Label column').first().selectOption('value');
  await pop.getByLabel('Output Value column').first().selectOption('Count');
  await expect(pop.getByRole('button', { name: 'Apply derived query to tile' })).toBeEnabled();
  await pop.getByRole('button', { name: 'Calculated field', exact: true }).click();
  await pop.getByLabel('Calculated field name').fill('Broken');
  await pop.getByLabel('Calculated field formula').fill('missing_column + 1');
  await pop.getByRole('button', { name: 'Preview formula' }).click();
  await expect(pop.locator('[role="alert"]').last()).toContainText(/column|identifier|binder|DuckDB/i, { timeout: 30000 });
});
