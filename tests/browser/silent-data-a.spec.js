import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
}

test('S1: real SQL registration and query results distinguish empty text, missing values, and whitespace', async ({ page }) => {
  await ready(page);
  const rows = await page.evaluate(async () => {
    const { saveDataset } = await import('/src/data/store.js');
    const { uploadTableName } = await import('/src/data/sql.js');
    const { runQuery } = await import('/src/data/duckdb.js');
    const { id } = saveDataset({name:'Text values',columns:['position','text'],rows:[{position:0,text:''},{position:1,text:null},{position:2,text:' '},{position:3,text:NaN}],fieldKeys:[],mapping:{}});
    return (await runQuery(`SELECT text FROM "${uploadTableName(id)}" ORDER BY position`)).rows;
  });
  expect(rows).toEqual([{text:''},{text:null},{text:' '},{text:null}]);
});
