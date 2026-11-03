import { test, expect } from '@playwright/test';

for (const omitProfile of [false,true]) {
  test(`S8: dashboard paste uses the production guided callback and persists once${omitProfile?' when caller profile is missing':''}`, async ({page}) => {
    if (omitProfile) await page.route('**/src/ui/dashboardDataPopover.js',async route=>{
      const response=await route.fetch();
      const source=(await response.text()).replace('onUpload({ name: "Pasted table", columns, rows, profile });','onUpload({ name: "Pasted table", columns, rows });');
      await route.fulfill({response,body:source});
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/');await expect(page.locator('#status')).toContainText('build');
    await page.evaluate(()=>{
      window.datasetWrites=0;const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='datasets')window.datasetWrites++;return put.apply(this,args);};
    });
    await page.locator('#btn-data').click();
    await page.getByLabel('Paste tabular data',{exact:true}).fill('Region\tAmount\nWest\t15\nEast\t20');
    await page.getByRole('button',{name:'Import pasted data',exact:true}).click();
    const guide=page.locator('.guided-dialog');await expect(guide).toBeVisible();
    await expect(guide.locator('.guided-suggestion')).toHaveCount(1);
    await guide.getByRole('button',{name:'Set as dashboard data',exact:true}).click();
    await expect(guide).toHaveCount(0);
    await expect(page.locator('#status')).toContainText('Dashboard data: Pasted table');
    const result=await page.evaluate(async()=>{
      const {listDatasets,getDataset}=await import('/src/data/store.js');
      const entries=listDatasets().map(item=>getDataset(item.id));
      return {writes:window.datasetWrites,entries:entries.map(({name,columns,rows,persisted})=>({name,columns,rows,persisted}))};
    });
    expect(errors).toEqual([]);expect(result).toEqual({writes:1,entries:[{name:'Pasted table',columns:['Region','Amount'],rows:[{Region:'West',Amount:'15'},{Region:'East',Amount:'20'}],persisted:true}]});
    await page.reload();await expect(page.locator('#status')).toContainText('build');
    expect(await page.evaluate(async()=> (await import('/src/data/store.js')).listDatasets())).toHaveLength(1);
  });
}
