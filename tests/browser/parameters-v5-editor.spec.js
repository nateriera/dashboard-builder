import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint=page.locator('.first-run-hint');
  if(await hint.isVisible().catch(()=>false))await hint.getByRole('button',{name:'Got it'}).click();
  await page.locator('#btn-filters').click();
  const popover=page.locator('.dashboard-filters-popover');
  await popover.getByRole('tab',{name:'Parameters'}).click();
  return popover;
}

test('T6 creates a select only after an explicit dataset, column and option refresh',async({page})=>{
  const popover=await ready(page);
  await popover.getByRole('button',{name:'Add parameter'}).click();
  await popover.getByLabel('New parameter type').selectOption('single-select');
  await popover.getByRole('button',{name:'Create parameter'}).click();
  await expect(popover.locator('.parameter-form .filters-form-error')).toContainText('Choose an explicit dataset and column');
  await popover.getByLabel('Select Source dataset').selectOption('categorical');
  await popover.getByLabel('Select Source column').selectOption('label');
  await popover.getByRole('button',{name:'Refresh options'}).click();
  await expect(popover.locator('.parameter-option-preview')).toContainText('8 stored options');
  await popover.getByRole('button',{name:'Create parameter'}).click();
  const row=popover.locator('.dashboard-parameter');
  await expect(row).toContainText('8 stored options');
  await expect(row.getByLabel('Value for parameter1')).toHaveValue('Housing');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dashboard-builder:layout:v1'))).not.toBeNull();
  await page.evaluate(()=>{const layout=JSON.parse(localStorage.getItem('dashboard-builder:layout:v1'));layout.parameters[0].value='Removed category';localStorage.setItem('dashboard-builder:layout:v1',JSON.stringify(layout));});
  await page.reload();
  await expect(page.locator('#status')).toContainText('build');
  await page.locator('#btn-filters').click();
  const reloaded=page.locator('.dashboard-filters-popover');await reloaded.getByRole('tab',{name:'Parameters'}).click();
  await expect(reloaded.locator('.parameter-stale-flag')).toContainText('“Removed category” is stale and is preserved.');
  await expect(reloaded.locator('.dashboard-parameter').getByLabel('Value for parameter1')).toHaveValue('Removed category');
  await page.locator('#btn-filters').click();
  await expect(page.locator('.dashboard-filters-popover')).toHaveCount(0);
});

test('T6 exposes boolean, date, ranges, and number step/integer editors',async({page})=>{
  const popover=await ready(page);
  await popover.getByRole('button',{name:'Add parameter'}).click();
  await popover.getByLabel('New parameter type').selectOption('boolean');
  await expect(popover.getByLabel('New parameter value')).toHaveAttribute('type','checkbox');
  await popover.getByLabel('New parameter type').selectOption('date');
  await expect(popover.getByLabel('New parameter value')).toHaveAttribute('type','date');
  await popover.getByLabel('New parameter type').selectOption('date-range');
  await expect(popover.locator('.parameter-bound input[type="date"]')).toHaveCount(2);
  await expect(popover.getByLabel('No lower bound',{exact:true})).toBeChecked();
  await popover.getByLabel('New parameter type').selectOption('number-range');
  await expect(popover.locator('.parameter-bound input[type="number"]')).toHaveCount(2);
  await popover.getByLabel('New parameter type').selectOption('number');
  await expect(popover.getByLabel('Parameter step')).toBeVisible();
  await expect(popover.getByLabel('Integer values')).toBeVisible();
});

test('T6 changes an existing parameter to select only after its source options are refreshed',async({page})=>{
  const popover=await ready(page);
  await popover.getByRole('button',{name:'Add parameter'}).click();
  await popover.getByRole('button',{name:'Create parameter'}).click();
  const row=popover.locator('.dashboard-parameter');
  await row.getByLabel('Type for parameter1').selectOption('single-select');
  await expect(row.getByLabel('Select Source dataset')).toBeVisible();
  await row.getByLabel('Select Source dataset').selectOption('categorical');
  await row.getByLabel('Select Source column').selectOption('label');
  await row.getByRole('button',{name:'Refresh options'}).click();
  await expect(row.getByLabel('Type for parameter1')).toHaveValue('single-select');
  await expect(row.getByLabel('Value for parameter1')).toHaveValue('Housing');
});

