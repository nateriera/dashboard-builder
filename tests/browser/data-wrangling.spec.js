import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

for (const action of ['Add grouping', 'Add aggregation']) {
  test(`wrangling integrity: ${action} invalidates a successful pivot preview`, async ({ page }) => {
    await ready(page);
    const pop = page.locator('.wrangling-popover');
    await expect(pop.getByLabel('Grouping 1 column')).toBeVisible();
    await pop.getByRole('button', { name: 'Preview pivot' }).click();
    await expect(pop.getByRole('button', { name: 'Apply derived query to tile' })).toBeEnabled();
    await pop.getByRole('button', { name: action, exact: true }).click();
    await expect(pop.locator('.data-apply')).toHaveCount(0);
    await expect(pop.locator('.data-panel:visible [role="status"]').last()).toHaveText('Preview is out of date; run again.');
  });
}

async function openParameterizedWrangling(page, kind = 'pivot', sql = 'SELECT {{label}} AS label, CAST({{factor}} AS DOUBLE) AS value') {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await page.evaluate(async ({ kind, sql }) => {
    const { saveQuery } = await import('/src/data/queries.js');
    const { toggleWranglingPopover } = await import('/src/ui/dataWranglingPopover.js');
    const saved = saveQuery({ sql });
    window.integrityParameters = [{ name: 'label', type: 'text', value: 'Snapshot' }, { name: 'factor', type: 'number', value: 2 }];
    toggleWranglingPopover({ anchor: document.querySelector('.tile-data-btn'), type: 'table', meta: { dataset: `query:${saved.id}` }, initialTab: kind, getParameters: () => window.integrityParameters, onQuery: query => { window.integrityApplied = query; } });
  }, { kind, sql });
  const pop = page.locator('.wrangling-popover');
  await expect(pop.getByLabel(kind === 'pivot' ? 'Grouping 1 column' : 'Calculated field formula')).toBeVisible();
  return pop;
}

test('wrangling integrity: semicolon-terminated sources load async schema and retain raw parameters', async ({ page }) => {
  const pop = await openParameterizedWrangling(page, 'pivot', 'SELECT {{label}} AS label, CAST({{factor}} AS DOUBLE) AS value; \n\t');
  await expect(pop.getByLabel('Grouping 1 column')).toHaveValue('label');
  await expect(pop.getByLabel('Aggregation 1 source column')).toHaveValue('value');
  await expect(pop.locator('[role="alert"]')).toHaveCount(0);
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  await expect(pop.locator('.data-panel:visible .data-preview tbody')).toContainText('Snapshot');
  await expect(pop.locator('.data-panel:visible .data-preview tbody')).toContainText('2');
  await pop.getByRole('button', { name: 'Apply derived query to tile' }).click();
  const savedSql = await page.evaluate(async () => (await import('/src/data/queries.js')).getQuery(window.integrityApplied.id).sql);
  expect(savedSql).toContain('{{label}}');
  expect(savedSql).toContain('{{factor}}');
  expect(savedSql).not.toMatch(/;\s*\)/);
});

async function holdPreviewCompletion(page) {
  await page.route('**/src/data/duckdb.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const original = 'export function runQueryDetailed(sql) { return coordinator.runDetailed(sql); }';
    expect(source).toContain(original);
    const instrumented = source.replace(original, `export async function runQueryDetailed(sql) {
      const result = await coordinator.runDetailed(sql);
      if (globalThis.holdIntegrityPreview && !/LIMIT 0\\s*$/i.test(sql)) {
        globalThis.integrityPreviewReady = true;
        await new Promise(resolve => { globalThis.releaseIntegrityPreview = resolve; });
      }
      return result;
    }`);
    await route.fulfill({ response, body: instrumented });
  });
}

for (const kind of ['pivot', 'formula']) {
  test(`wrangling integrity: ${kind} edit during a real in-flight preview discards its result`, async ({ page }) => {
    await holdPreviewCompletion(page);
    const pop = await openParameterizedWrangling(page, kind);
    if (kind === 'formula') {
      await pop.getByLabel('Calculated field name').fill('Adjusted');
      await pop.getByLabel('Calculated field formula').fill('"value" * 2');
    }
    await page.evaluate(() => { window.holdIntegrityPreview = true; });
    await pop.getByRole('button', { name: kind === 'pivot' ? 'Preview pivot' : 'Preview formula' }).click();
    await expect.poll(() => page.evaluate(() => window.integrityPreviewReady)).toBe(true);
    if (kind === 'pivot') await pop.getByLabel('Aggregation 1 output name').fill('Edited total');
    else await pop.getByLabel('Calculated field formula').fill('"value" * 3');
    await page.evaluate(() => { window.holdIntegrityPreview = false; window.releaseIntegrityPreview(); });
    await expect(pop.locator('.data-panel:visible [role="status"]').last()).toHaveText('Preview is out of date; run again.');
    await expect(pop.locator('.data-apply')).toHaveCount(0);
    await expect(pop.locator('.data-preview tbody')).toHaveCount(0);
    await pop.getByRole('button', { name: kind === 'pivot' ? 'Preview pivot' : 'Preview formula' }).click();
    const apply = pop.getByRole('button', { name: 'Apply derived query to tile' });
    await expect(apply).toBeEnabled();
    await expect(pop.locator('.data-panel:visible .data-preview')).toContainText(kind === 'pivot' ? 'Edited total' : '6');
    await apply.click();
    const savedSql = await page.evaluate(async () => (await import('/src/data/queries.js')).getQuery(window.integrityApplied.id).sql);
    expect(savedSql).toContain(kind === 'pivot' ? 'AS "Edited total"' : '("value" * 3) AS "Adjusted"');
    expect(savedSql).toContain('{{factor}}');
  });
}

test('wrangling integrity: parameter edits during preview discard the captured result', async ({ page }) => {
  await holdPreviewCompletion(page);
  const pop = await openParameterizedWrangling(page);
  await page.evaluate(() => { window.holdIntegrityPreview = true; });
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  await expect.poll(() => page.evaluate(() => window.integrityPreviewReady)).toBe(true);
  await page.evaluate(() => { window.integrityParameters[1].value = 3; window.holdIntegrityPreview = false; window.releaseIntegrityPreview(); });
  await expect(pop.locator('.data-panel:visible [role="status"]').last()).toHaveText('Preview is out of date; run again.');
  await expect(pop.locator('.data-apply')).toHaveCount(0);
});

test('wrangling integrity: Apply rechecks parameter tokens even without a dirty event', async ({ page }) => {
  const pop = await openParameterizedWrangling(page);
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  const apply = pop.getByRole('button', { name: 'Apply derived query to tile' });
  await expect(apply).toBeEnabled();
  // Change a live execution input without dispatching a control event/invalidate().
  await page.evaluate(() => { window.integrityParameters[1].value = 3; });
  await apply.click();
  expect(await page.evaluate(() => window.integrityApplied)).toBeUndefined();
  await expect(pop.locator('.data-apply')).toHaveCount(0);
  await expect(pop.locator('.data-panel:visible [role="status"]').last()).toHaveText('Preview is out of date; run again.');
});

test('parameterized wrangling preserves placeholders, never rescans values, and follows parameter changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await page.evaluate(async () => {
    const { saveQuery } = await import('/src/data/queries.js');
    const { toggleWranglingPopover } = await import('/src/ui/dataWranglingPopover.js');
    const saved = saveQuery({ sql: 'SELECT {{p}} AS label, CAST({{factor}} AS DOUBLE) AS value' });
    window.wrangleParameters = [{ name: 'p', type: 'text', value: '{{q}}' }, { name: 'q', type: 'text', value: 'expanded' }, { name: 'factor', type: 'number', value: 2 }];
    toggleWranglingPopover({ anchor: document.querySelector('.tile-data-btn'), type: 'table', meta: { dataset: `query:${saved.id}` }, getParameters: () => window.wrangleParameters, onQuery: derived => { window.derivedQuery = derived; } });
  });
  const pop = page.locator('.wrangling-popover');
  await expect(pop.getByLabel('Grouping 1 column')).toBeVisible();
  await pop.getByRole('button', { name: 'Preview pivot' }).click();
  await expect(pop.locator('.data-panel:visible .data-preview tbody')).toContainText('{{q}}');
  await expect(pop.locator('.data-panel:visible .data-preview tbody')).toContainText('2');
  await pop.getByRole('button', { name: 'Apply derived query to tile' }).click();
  const result = await page.evaluate(async () => {
    const { getQuery } = await import('/src/data/queries.js');
    const { runTileQuery } = await import('/src/data/duckdb.js');
    const { TILE_TYPES } = await import('/src/tiles/registry.js');
    const query = getQuery(window.derivedQuery.id);
    window.wrangleParameters.find(p => p.name === 'factor').value = 3;
    return { sql: query.sql, rows: await runTileQuery(query.id, query, TILE_TYPES.table, window.wrangleParameters) };
  });
  expect(result.sql).toContain('{{p}}');
  expect(result.sql).toContain('{{factor}}');
  expect(result.rows).toEqual([{ label: '{{q}}', 'Sum of value': 3 }]);
});

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
  const recipeDownload=page.waitForEvent('download');
  await pop.getByRole('button',{name:'Export recipes'}).click();
  const recipeFile=await recipeDownload;
  const portable=JSON.parse(await fs.readFile(await recipeFile.path(),'utf8'));
  portable.recipes[0].groups[0].column='Category';
  portable.recipes[0].aggregations[0].column='Count';
  const recipeBuffer=Buffer.from(JSON.stringify(portable));
  await page.evaluate(()=>localStorage.removeItem('dashbuilder.wrangling-recipes.v1'));
  await pop.getByLabel('Pivot recipe file').setInputFiles({name:'portable-recipes.json',mimeType:'application/json',buffer:recipeBuffer});
  await expect(pop.getByLabel('Pivot recipe',{exact:true})).toContainText('Category totals');
  await pop.locator('[aria-label="Grouping 1 column"]').selectOption('value');
  await pop.locator('[aria-label="Pivot recipe"]').selectOption({label:'Category totals'});
  await pop.getByRole('button',{name:'Load recipe'}).click();
  await pop.getByLabel('Map recipe column Category').selectOption('label');
  await pop.getByLabel('Map recipe column Count').selectOption('value');
  await pop.getByRole('button',{name:'Apply column mapping'}).click();
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
  await pop.getByLabel('Formula recipe name').fill('Doubled value recipe');
  await pop.getByRole('button',{name:'Save recipe'}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dashbuilder.wrangling-recipes.v1')||'[]')[0]?.columns)).toEqual(['value']);
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
