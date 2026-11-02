import { test, expect } from '@playwright/test';

const layoutKey = 'dashboard-builder:layout:v1';
const queryKey = 'dashbuilder.queries.v1';
const tile = (id, dataset) => ({ id, type:'bar', dataset, title:id, x:0,y:0,w:6,h:5 });
const layout = (tiles, datasets = {}, queries = {}) => ({ app:'dashboard-builder',version:1,theme:'paper',tiles,datasets,queries });
const candidate = layout([tile('candidate', 'upload:rollback-new')], {
  'rollback-new': { name:'New import',columns:['label','value'],rows:[{label:'Imported',value:9}],fieldKeys:['label','value'],mapping:{label:'label',value:'value'},raw:null }
}, {
  'candidate-query': { name:'Candidate query',sql:'SELECT label, value FROM categorical',columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'} }
});

async function importLayout(page, input) {
  await page.locator('#status').evaluate(element => { element.textContent = 'Reading rollback fixture…'; });
  await page.locator('#file-import').setInputFiles({ name:'rollback-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input)) });
  await expect(page.locator('#status')).toContainText(/Imported|Import failed/);
}

for (const persisted of [true, false]) {
  test(`round-trip R4: dataset rollback failure still restores ${persisted ? 'existing' : 'absent'} storage keys and preserves the import error`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toContainText('build');
    await importLayout(page, layout([tile('prior', 'categorical')]));
    await expect(page.locator('#status')).toContainText('Imported');
    const before = await page.evaluate(async ({ layoutKey, queryKey, persisted }) => {
      const queries = await import('/src/data/queries.js');
      if (persisted) queries.saveQuery({ name:'Prior trusted query',sql:'SELECT 1 AS value',columns:['value'],fieldKeys:['value'],mapping:{value:'value'} });
      else { localStorage.removeItem(layoutKey); localStorage.removeItem(queryKey); }
      return { layout:localStorage.getItem(layoutKey),queries:localStorage.getItem(queryKey),snapshot:queries.querySnapshot() };
    }, { layoutKey, queryKey, persisted });

    await page.evaluate(({ layoutKey, queryKey }) => {
      const set = Storage.prototype.setItem;
      const remove = Storage.prototype.removeItem;
      const deleteRecord = IDBObjectStore.prototype.delete;
      const probe = window.rollbackProbe = { originalFailure:false,storageAttempts:[],deletes:[] };
      Storage.prototype.setItem = function (key, value) {
        if (key === layoutKey && !probe.originalFailure && String(value).includes('"id":"candidate"')) {
          probe.originalFailure = true;
          throw new Error('Injected original import failure');
        }
        if (probe.originalFailure && [layoutKey, queryKey].includes(key)) probe.storageAttempts.push({ method:'setItem',key,value });
        return set.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (probe.originalFailure && [layoutKey, queryKey].includes(key)) probe.storageAttempts.push({ method:'removeItem',key });
        return remove.call(this, key);
      };
      IDBObjectStore.prototype.delete = function (id, ...rest) {
        if (id === 'rollback-new') {
          probe.deletes.push(id);
          throw new Error('Injected dataset rollback failure');
        }
        return deleteRecord.call(this, id, ...rest);
      };
    }, { layoutKey, queryKey });

    await importLayout(page, candidate);
    await expect(page.locator('#status')).toContainText('Import failed: Injected original import failure');
    await expect(page.locator('#status')).toContainText(/rollback.*incomplete|incomplete.*rollback/i);
    await expect(page.locator('.grid-stack-item[gs-id="prior"]')).toBeVisible();
    await expect(page.locator('.grid-stack-item[gs-id="candidate"]')).toHaveCount(0);
    const after = await page.evaluate(async ({ layoutKey, queryKey }) => {
      const queries = await import('/src/data/queries.js');
      const { getDataset } = await import('/src/data/store.js');
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('dashbuilder');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const durable = await new Promise((resolve, reject) => {
        const request = db.transaction('datasets', 'readonly').objectStore('datasets').get('rollback-new');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      const { persisted, ...memory } = getDataset('rollback-new');
      return { layout:localStorage.getItem(layoutKey),queries:localStorage.getItem(queryKey),snapshot:queries.querySnapshot(),
        recovery:JSON.parse(localStorage.getItem(layoutKey + ':recovery')),probe:window.rollbackProbe,memory,durable };
    }, { layoutKey, queryKey });
    expect(after.layout).toBe(before.layout);
    expect(after.queries).toBe(before.queries);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.recovery.layout.tiles.map(item => item.id)).toEqual(['prior']);
    expect(after.recovery.queries).toEqual(before.snapshot);
    expect(after.probe.deletes).toEqual(['rollback-new']);
    expect(after.probe.storageAttempts).toEqual(persisted
      ? [{ method:'setItem',key:queryKey,value:before.queries },{ method:'setItem',key:layoutKey,value:before.layout }]
      : [{ method:'removeItem',key:queryKey },{ method:'removeItem',key:layoutKey }]);
    // Failed deletion leaves an unreferenced new dataset, consistently in both stores.
    expect(after.memory).toEqual(after.durable);
  });
}
