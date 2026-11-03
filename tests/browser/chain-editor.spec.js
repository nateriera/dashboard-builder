import { acceptImportConfirmation } from './accept-import.js';
import { test, expect } from '@playwright/test';

const fixtureSql=`SELECT i AS sequence,
  CASE i % 4 WHEN 0 THEN 'A' WHEN 1 THEN 'B' WHEN 2 THEN 'C' ELSE 'D' END AS team,
  CASE WHEN i IN (3,7) THEN NULL ELSE CAST(i AS DOUBLE) END AS amount,
  CASE WHEN i = 5 THEN 'bad-date' ELSE '2026-01-' || lpad(CAST(i + 1 AS VARCHAR),2,'0') END AS date
  FROM range(0,20) AS t(i)`;

async function openEditor(page,{type='table',parameters=[]}={}) {
  await page.goto('/');await expect(page.locator('#status')).toContainText('build');
  const hint=page.locator('.first-run-hint');
  if(await hint.isVisible())await hint.getByRole('button',{name:'Got it'}).click();
  const id=await page.evaluate(async ({sql,type})=>(await import('/src/data/queries.js')).saveQuery({
    name:'Editor source',sql,columns:['sequence','team','amount','date'],
    fieldKeys:type==='bar'?['label','value']:[],mapping:type==='bar'?{label:'team',value:'amount'}:{}
  }).id,{sql:fixtureSql,type});
  const layout={app:'dashboard-builder',version:1,parameters,tiles:[{id:'chain-editor',type,title:'Chain editor',dataset:`query:${id}`,x:0,y:0,w:8,h:7}]};
  await page.locator('#file-import').setInputFiles({name:'chain-editor.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(layout))});
  await expect(page.locator('#status')).toContainText('Imported');
  await page.locator('.tile-data-btn').click();
  const data=page.locator('.data-popover:not(.wrangling-popover)');
  await expect(data.getByRole('button',{name:'Group & summarize',exact:true})).toBeVisible();
  await expect(data.getByRole('button',{name:'Pivot',exact:true})).toHaveCount(0);
  await data.getByRole('button',{name:'Transform',exact:true}).click();
  const editor=page.locator('.wrangling-popover');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button',{name:'Group & summarize',exact:true})).toBeVisible();
  await expect(editor.getByRole('button',{name:'Pivot',exact:true})).toHaveCount(0);
  await expect(editor.getByLabel('New transform operation',{exact:true})).toBeVisible();
  return editor;
}
async function sourceOrder(editor) {
  await editor.getByLabel('Source order',{exact:true}).selectOption('columns');
  await editor.getByLabel('Source order fields',{exact:true}).selectOption(['sequence']);
}
async function addGroup(editor,index,{groups=['team'],column='amount',operation='SUM',name='Total'}={}) {
  await editor.getByLabel('New transform operation',{exact:true}).selectOption('groupBy');
  await editor.getByRole('button',{name:'Add step',exact:true}).click();
  await editor.getByLabel(`Step ${index} grouping columns`,{exact:true}).selectOption(groups);
  await editor.getByLabel(`Step ${index} aggregation 1 source column`,{exact:true}).selectOption(column);
  await editor.getByLabel(`Step ${index} aggregation 1 operation`,{exact:true}).selectOption(operation);
  await editor.getByLabel(`Step ${index} aggregation 1 output name`,{exact:true}).fill(name);
}
const enabledApply=editor=>editor.locator('.data-apply:enabled');
const preview=editor=>editor.getByRole('button',{name:'Preview transforms',exact:true});

test('GA-1 editor: unordered GroupBy is disabled with a reason, and explicit order enables full counts and provenance',async({page})=>{
  const editor=await openEditor(page);
  const offered=await editor.getByLabel('New transform operation',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
  expect(offered).toEqual(['groupBy','bucket','between','top','movingAvg','stats','cumulative','change','periodPair','pivot','histogram','ratio']);
  await addGroup(editor,1);
  await expect(editor.getByLabel('Step 1 operation',{exact:true})).toHaveValue('groupBy');
  await expect(editor.locator('.transform-step')).toContainText(/deterministic|incoming order|source order/i);
  await expect(enabledApply(editor)).toHaveCount(0);
  await sourceOrder(editor);await preview(editor).click();
  await expect(enabledApply(editor)).toHaveCount(1);
  const step=editor.locator('.transform-step');
  await expect(step.locator('.transform-count')).toContainText('20');
  await expect(step.locator('.transform-count')).toContainText('4');
  await expect(step.locator('.transform-provenance')).toContainText('Total');
  await expect(step.locator('.transform-provenance')).toContainText('2');
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(4);
  expect(await editor.locator('.transform-preview tbody tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent)))).toEqual([['A','40'],['B','45'],['C','50'],['D','45']]);
  await editor.screenshot({path:'test-results/chain-editor.png'});
});

test('GA-1 editor: add/remove/reorder invalidate preview and revalidate every dependent step',async({page})=>{
  const editor=await openEditor(page);await sourceOrder(editor);
  await addGroup(editor,1);await addGroup(editor,2,{column:'Total',name:'Grand total'});
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await editor.getByRole('button',{name:'Move step 2 up',exact:true}).click();
  await expect(enabledApply(editor)).toHaveCount(0);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(0);
  await expect(editor.locator('.transform-step').first()).toContainText(/Total.*unavailable|unavailable.*Total|missing.*Total/i);
  await editor.getByRole('button',{name:'Move step 1 down',exact:true}).click();
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await editor.getByRole('button',{name:'Remove step 2',exact:true}).click();
  await expect(editor.locator('.transform-step')).toHaveCount(1);
  await expect(enabledApply(editor)).toHaveCount(0);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(0);
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await editor.getByLabel('New transform operation',{exact:true}).selectOption('bucket');
  await editor.getByRole('button',{name:'Add step',exact:true}).click();
  await expect(editor.locator('.transform-step')).toHaveCount(2);
  await expect(enabledApply(editor)).toHaveCount(0);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(0);
});

test('GA-1 editor: preview shows at most five sample rows while the step displays its full output count',async({page})=>{
  const editor=await openEditor(page);await sourceOrder(editor);
  await addGroup(editor,1,{groups:['sequence']});
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(5);
  await expect(editor.locator('.transform-count')).toContainText('20');
  expect(await editor.locator('.transform-preview tbody tr td:first-child').allTextContents()).toEqual(['0','1','2','3','4']);
});

test('GA-1 editor: missing chart output mapping blocks Apply until both required fields are mapped',async({page})=>{
  const editor=await openEditor(page,{type:'bar'});await sourceOrder(editor);
  await addGroup(editor,1,{groups:['sequence'],name:'Metric'});
  await preview(editor).click();
  await expect(editor.getByLabel('Output Label column',{exact:true})).toHaveValue('');
  await expect(editor.getByLabel('Output Value column',{exact:true})).toHaveValue('');
  await expect(enabledApply(editor)).toHaveCount(0);
  await editor.getByLabel('Output Label column',{exact:true}).selectOption('sequence');
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(0);
  await editor.getByLabel('Output Value column',{exact:true}).selectOption('Metric');
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await enabledApply(editor).click();await expect(editor).toHaveCount(0);
  const saved=await page.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items).find(query=>query.chain));
  expect(saved.chain.outputMapping).toEqual({label:'sequence',value:'Metric'});
  expect(saved.mapping).toEqual(saved.chain.outputMapping);
});

async function holdRealPreview(page,{exposeParameters=false}={}) {
  if(exposeParameters)await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    expect(source).toContain('getParameters: () => parameters');
    await route.fulfill({response,body:source.replaceAll('getParameters: () => parameters','getParameters: () => (globalThis.chainEditorParameters = parameters)')});
  });
  await page.route('**/src/data/duckdb.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const declaration='export async function previewTransformChain(';
    expect(source).toContain(declaration);
    const body=source.replace(declaration,'async function realChainEditorPreview(')+`\nexport async function previewTransformChain(...args) {
      const result = await realChainEditorPreview(...args);
      if (globalThis.holdChainEditorPreview) {
        globalThis.chainEditorPreviewReady = true;
        await new Promise(resolve => { globalThis.releaseChainEditorPreview = resolve; });
      }
      return result;
    }\n`;
    await route.fulfill({response,body});
  });
}

test('GA-1 editor: Add during a real in-flight preview discards the completed old result',async({page})=>{
  await holdRealPreview(page);
  const editor=await openEditor(page);await sourceOrder(editor);await addGroup(editor,1);
  await page.evaluate(()=>{globalThis.holdChainEditorPreview=true;});
  await preview(editor).click();await expect(preview(editor)).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>globalThis.chainEditorPreviewReady)).toBe(true);
  await editor.getByRole('button',{name:'Add step',exact:true}).click();
  await expect(editor.locator('.transform-step')).toHaveCount(2);
  await page.evaluate(()=>{globalThis.holdChainEditorPreview=false;globalThis.releaseChainEditorPreview();});
  await expect(preview(editor)).toBeEnabled();
  await expect(enabledApply(editor)).toHaveCount(0);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(0);
});

test('GA-1 editor: existing parameter picker keeps references raw and a value change discards an in-flight result',async({page})=>{
  await holdRealPreview(page,{exposeParameters:true});
  const editor=await openEditor(page,{parameters:[{name:'grain',type:'text',value:'month'},{name:'count',type:'number',value:2}]});
  await editor.getByLabel('New transform operation',{exact:true}).selectOption('bucket');
  await editor.getByRole('button',{name:'Add step',exact:true}).click();
  await editor.getByLabel('Step 1 date column',{exact:true}).selectOption('date');
  await editor.getByLabel('Step 1 grain',{exact:true}).selectOption('parameter');
  const picker=editor.getByLabel('Step 1 grain parameter',{exact:true});
  const offered=await picker.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
  expect(offered).toEqual(['grain']);await picker.selectOption('grain');
  await editor.getByLabel('Step 1 aggregation 1 source column',{exact:true}).selectOption('amount');
  await editor.getByLabel('Step 1 aggregation 1 operation',{exact:true}).selectOption('SUM');
  await editor.getByLabel('Step 1 aggregation 1 output name',{exact:true}).fill('Total');
  await page.evaluate(()=>{globalThis.holdChainEditorPreview=true;});
  await preview(editor).click();
  await expect.poll(()=>page.evaluate(()=>globalThis.chainEditorPreviewReady)).toBe(true);
  await page.evaluate(()=>{globalThis.chainEditorParameters.find(parameter=>parameter.name==='grain').value='day';globalThis.holdChainEditorPreview=false;globalThis.releaseChainEditorPreview();});
  await expect(preview(editor)).toBeEnabled();
  await expect(enabledApply(editor)).toHaveCount(0);
  await expect(editor.locator('.transform-preview tbody tr')).toHaveCount(0);
  await preview(editor).click();await expect(enabledApply(editor)).toHaveCount(1);
  await expect(editor.locator('.transform-provenance')).toHaveText(['2 invalid/missing values excluded from Total','1 bad dates dropped']);
  await expect(editor.locator('.transform-count')).toHaveText('20 rows → 20 rows');
  await enabledApply(editor).click();
  const saved=await page.evaluate(async()=>Object.values(JSON.parse((await import('/src/data/queries.js')).serializeQueries()).items).find(query=>query.chain));
  expect(saved.chain.steps[0].params.grain).toEqual({param:'grain'});
  expect(saved.sql).toContain('{{grain}}');
  expect(saved.parameterDependencies).toContain('grain');
});

acceptImportConfirmation(test);
