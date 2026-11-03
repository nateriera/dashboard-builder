import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

test('SQL result mapping selects have accessible names for their target roles', async ({page}) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item').nth(1);
  await tile.locator('.tile-data-btn').click();
  const popover = page.getByRole('dialog', {name: 'Tile data'});
  await popover.getByRole('button', {name: 'SQL'}).click();
  const run = popover.getByRole('button', {name: 'Run', exact: true});
  await expect(run).toBeEnabled({timeout: 90000});
  await popover.getByLabel('SQL query').fill("SELECT 'North' AS source_label, 10 AS amount");
  await run.click();
  const mapping = popover.locator('.data-mapping');
  await expect(mapping.locator('select')).toHaveCount(2, {timeout: 90000});
  await expect(mapping.getByLabel('Map SQL result column to Label column')).toBeVisible();
  await expect(mapping.getByLabel('Map SQL result column to Value column')).toBeVisible();
});

test('SQL normalization errors identify the field and leave mapping controls enabled', async ({page}) => {
  await ready(page);
  const tile = page.locator('.grid-stack-item').nth(1);
  await tile.locator('.tile-data-btn').click();
  const popover = page.getByRole('dialog', {name: 'Tile data'});
  await popover.getByRole('button', {name: 'SQL'}).click();
  const run = popover.getByRole('button', {name: 'Run', exact: true});
  await expect(run).toBeEnabled({timeout: 90000});
  await popover.getByLabel('SQL query').fill("SELECT 'North' AS label, '9007199254740993' AS value");
  await run.click();
  const alert = popover.getByRole('alert');
  await expect(alert).toContainText('Value column');
  await expect(alert).toContainText('SQL result column “value”');
  await expect(popover.locator('.data-mapping:visible')).toHaveCount(1);
  await expect(popover.locator('.data-mapping select').last()).toBeEnabled();
});

test('dashboard data copy reports live default and own-data tile counts', async ({page}) => {
  await ready(page);
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  await page.locator('#btn-data').click();
  const popover = page.getByRole('dialog', {name: 'Dashboard data'});
  await expect(popover.locator('.data-sql-note').first()).toContainText('1 tile follows dashboard data and 5 use their own data');
  await expect(popover.locator('.data-sql-note').first()).toContainText('updates the following tile');
  await expect(popover.locator('.data-sql-note').first()).toContainText('5 tiles with their own data stay unchanged');
});

test('clicking a palette item scrolls the new tile into view and focuses its title', async ({page}) => {
  await ready(page);
  await page.locator('.palette-item[data-tile-type="bar"]').click();
  const title = page.locator('.grid-stack-item').last().locator('.tile-title');
  await expect(title).toBeFocused({timeout: 5000});
  await expect(title).toBeInViewport();
});
