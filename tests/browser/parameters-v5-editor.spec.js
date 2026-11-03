import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
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
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
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

test('slice 2 renders every live parameter type through its bound filter and reset restores defaults',async({page})=>{
  await page.goto('/');
  const template=await page.evaluate(async()=>await(await fetch('/export-template.html')).text());
  const cases=[
    {type:'number',value:1,filter:{field:'score',op:'is',values:[1]},rows:[{score:1},{score:2}],changed:'2',default:'1',change:async control=>control.fill('2')},
    {type:'text',value:'West',filter:{field:'region',op:'is',values:['West']},rows:[{region:'West'},{region:'East'}],changed:'East',default:'West',change:async control=>control.fill('East')},
    {type:'boolean',value:true,filter:{field:'active',op:'is',values:[true]},rows:[{active:true},{active:false}],changed:'false',default:'true',change:async control=>control.uncheck()},
    {type:'date',value:'2025-01-01',filter:{field:'day',op:'is',values:['2025-01-01']},rows:[{day:'2025-01-01'},{day:'2025-01-02'}],changed:'2025-01-02',default:'2025-01-01',change:async control=>control.fill('2025-01-02')},
    {type:'single-select',value:'West',source:{dataset:'sample',column:'region'},options:['West','East'],filter:{field:'region',op:'is',values:['West']},rows:[{region:'West'},{region:'East'}],changed:'East',default:'West',change:async control=>control.selectOption('East')},
    {type:'multi-select',value:['West'],source:{dataset:'sample',column:'region'},options:['West','East'],filter:{field:'region',op:'is',values:['West']},rows:[{region:'West'},{region:'East'}],changed:'East',default:'West',change:async control=>control.selectOption('East')},
    {type:'number-range',value:{from:1,to:2},filter:{field:'score',op:'between',values:[1,2]},rows:[{score:1},{score:2},{score:3}],changed:'1',default:'1',change:async(_,root)=>root.getByLabel('amount to').fill('1')},
    {type:'date-range',value:{from:'2025-01-01',to:'2025-01-02'},filter:{field:'day',op:'date-between',values:['2025-01-01','2025-01-02']},rows:[{day:'2025-01-01'},{day:'2025-01-02'},{day:'2025-01-03'}],changed:'2025-01-01',default:'2025-01-01',change:async(_,root)=>root.getByLabel('period to').fill('2025-01-01')}
  ];
  for(const [index,item] of cases.entries()){
    const filter={id:`filter-${index}`,...item.filter};
    const parameter={name:item.type==='number-range'?'amount':item.type==='date-range'?'period':'value',...item,bindings:[{kind:'filter',filterId:filter.id}]};
    const payload={version:5,title:'Bound viewer',currentPageId:'page-1',pages:[{id:'page-1',name:'Dashboard'}],filters:[filter],parameters:[parameter],frozenParameters:[],tiles:[{id:'table-1',type:'table',title:'Rows',x:0,y:0,w:12,h:7,rows:item.rows}]};
    const html=template.replace('__DASHBOARD_PAYLOAD__',JSON.stringify(payload).replace(/</g,'\\u003c'));
    await page.setContent(html,{waitUntil:'networkidle'});
    const root=page.locator('.export-filters');
    await expect(root.locator('.export-parameter-control')).toBeVisible();
    await expect(page.locator('.db-data-table tbody tr')).toHaveCount(item.type.endsWith('-range')?2:1);
    const control=root.getByLabel(item.type==='number-range'?'amount from':item.type==='date-range'?'period from':parameter.name);
    if(item.type==='number-range'||item.type==='date-range')await item.change(control,root);else await item.change(control,root);
    await expect(page.locator('.db-data-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.db-data-table tbody tr')).toContainText(item.changed);
    await root.getByRole('button',{name:'Reset filters'}).click();
    await expect(page.locator('.db-data-table tbody tr')).toHaveCount(item.rows.length===3?2:1);
    await expect(page.locator('.db-data-table')).toContainText(item.default);
  }
});

test('slice 2 keeps SQL-referencing bound parameters frozen and disclosed in the viewer',async({page})=>{
  await page.goto('/');
  const template=await page.evaluate(async()=>await(await fetch('/export-template.html')).text());
  const types=[['n','number',1],['txt','text','West'],['flag','boolean',true],['day','date','2025-01-01'],['one','single-select','West'],['many','multi-select',['West']],['nr','number-range',{from:1,to:1}],['dr','date-range',{from:'2025-01-01',to:'2025-01-01'}]];
  const parameters=types.map(([name,type,value],index)=>({name,type,value,...(['single-select','multi-select'].includes(type)?{source:{dataset:'categorical',column:'label'},options:['West']}:{}),bindings:[{kind:'filter',filterId:`filter-${index}`}]}));
  const filters=types.map(([name,type,value],index)=>({id:`filter-${index}`,field:['number-range','date-range'].includes(type)?(type==='number-range'?'score':'day'):['number','number-range'].includes(type)?'score':['boolean'].includes(type)?'active':['date','date-range'].includes(type)?'day':'region',op:type==='number-range'?'between':type==='date-range'?'date-between':'is',values:type==='number-range'?[1,1]:type==='date-range'?['2025-01-01','2025-01-01']:type==='multi-select'?value:[value]}));
  const payload={version:5,title:'Frozen',filters,parameters,frozenParameters:parameters.map(({name,value})=>({name,value})),tiles:[{id:'table-1',type:'table',x:0,y:0,w:12,h:7,rows:[{score:1,region:'West',active:true,day:'2025-01-01'}]}]};
  await page.setContent(template.replace('__DASHBOARD_PAYLOAD__',JSON.stringify(payload)),{waitUntil:'networkidle'});
  await expect(page.locator('.export-parameter-control')).toHaveCount(0);
  for(const [name] of types)await expect(page.locator('.export-frozen-parameters')).toContainText(name);
});

test('slice 2 binds a filter, syncs values, surfaces multi-value conflict, and detaches through the guard',async({page})=>{
  await page.goto('/');await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await page.evaluate(()=>localStorage.setItem('dashboard-builder:layout:v1',JSON.stringify({
    app:'dashboard-builder',version:5,rowHeight:24,
    parameters:[{name:'choice',type:'single-select',value:'Housing',source:{dataset:'categorical',column:'label'},options:['Housing','Food']}],
    filters:[{id:'filter-choice',field:'label',op:'is',values:['Housing']}],
    tiles:[{id:'tile-choice',type:'table',dataset:'categorical',binding:{mode:'explicit',ref:'categorical'},x:0,y:0,w:12,h:7}]
  })));
  const layoutError=await page.evaluate(async()=>{try{const {validateLayout}=await import('/src/data/layout.js');validateLayout(JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')));return null;}catch(error){return error.message;}});
  expect(layoutError).toBeNull();
  await page.reload();await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await page.locator('#btn-filters').click();const pop=page.locator('.dashboard-filters-popover');
  await pop.getByRole('tab',{name:'Parameters'}).click();const row=pop.locator('.dashboard-parameter');
  await row.getByLabel('Filter binding for choice').selectOption('filter-choice');
  await row.getByLabel('Value for choice').selectOption('Food');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).filters[0].values)).toEqual(['Food']);
  await row.getByLabel('Rename parameter choice').fill('renamed');await row.getByLabel('Rename parameter choice').press('Tab');
  await expect(row.locator('.parameter-consumer-warning')).toContainText('Filter “label”');
  await pop.getByRole('tab',{name:'Filters'}).click();
  await pop.getByRole('button',{name:'Edit label filter'}).click();
  const unchecked=pop.locator('.filter-values input[type="checkbox"]:not(:checked)').first();await unchecked.check();
  await pop.getByRole('button',{name:'Apply filter'}).click();
  await pop.getByRole('tab',{name:'Parameters'}).click();
  await expect(row.locator('.parameter-binding-conflict')).toContainText('disagree');
  await row.getByLabel('Rename parameter choice').fill('renamed');await row.getByLabel('Rename parameter choice').press('Tab');
  await row.getByRole('button',{name:'Detach filter consumers'}).click();
  await expect(pop.getByLabel('Rename parameter renamed')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dashboard-builder:layout:v1')).parameters[0].bindings)).toBeUndefined();
});

test('slice 2 applies saved-view filter state around bound controls and reset returns to export defaults',async({page})=>{
  await page.goto('/');
  const template=await page.evaluate(async()=>await(await fetch('/export-template.html')).text());
  const payload={version:5,title:'Saved view bindings',currentPageId:'page-1',pages:[{id:'page-1',name:'Dashboard'}],
    parameters:[{name:'region',type:'text',value:'West',bindings:[{kind:'filter',filterId:'bound-region'}]}],
    filters:[{id:'bound-region',field:'region',op:'is',values:['West']},{id:'active-filter',field:'active',op:'is',values:[true]}],
    savedViews:[{id:'view-1',name:'West inactive',theme:'paper',currentPageId:'page-1',filters:[{id:'bound-region',field:'region',op:'is',values:['West']},{id:'active-filter',field:'active',op:'is',values:[false]}],parameters:[{name:'region',type:'text',value:'West'}]}],
    frozenParameters:[],tiles:[{id:'table-1',type:'table',x:0,y:0,w:12,h:7,rows:[{region:'West',active:true},{region:'West',active:false},{region:'East',active:true}]}]};
  await page.setContent(template.replace('__DASHBOARD_PAYLOAD__',JSON.stringify(payload)),{waitUntil:'networkidle'});
  const region=page.locator('.export-parameter-control input[aria-label="region"]');await expect(region).toHaveValue('West');
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(1);await expect(page.locator('.db-data-table')).toContainText('true');
  await page.getByLabel('Saved dashboard view',{exact:true}).selectOption('view-1');await page.getByRole('button',{name:'Apply view'}).click();
  await expect(page.locator('.db-data-table tbody tr')).toHaveCount(1);await expect(page.locator('.db-data-table')).toContainText('false');
  await expect(page.locator('.export-parameter-control input[aria-label="region"]')).toHaveValue('West');
  await page.getByRole('button',{name:'Reset filters'}).click();
  await expect(page.locator('.db-data-table')).toContainText('true');
});

test('slice 2 number slider and numeric input stay synchronized and honor integer step',async({page})=>{
  await page.goto('/');await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await page.evaluate(()=>localStorage.setItem('dashboard-builder:layout:v1',JSON.stringify({app:'dashboard-builder',version:5,rowHeight:24,parameters:[{name:'count',type:'number',value:4,min:0,max:10,step:2,integer:true}],tiles:[]})));
  await page.reload();await page.locator('#btn-filters').click();const pop=page.locator('.dashboard-filters-popover');
  await pop.getByRole('tab',{name:'Parameters'}).click();
  const value=pop.getByLabel('Value for count'),slider=pop.getByLabel('Slider for count');
  await expect(slider).toHaveAttribute('step','2');await expect(value).toHaveAttribute('step','2');
  await slider.evaluate(el=>{el.value='8';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await expect(value).toHaveValue('8');
  await value.fill('6');await value.dispatchEvent('change');await expect(slider).toHaveValue('6');
});

