import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const key = 'dashboard-builder:layout:v1';
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  await expect(page.locator('.tile')).toHaveCount(5);
  await expect(page.locator('[gs-id="import-1"] svg').first()).toBeVisible();
}
async function saved(page) {
  await page.locator('#btn-save').click();
  return page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
}
async function dimensions(tile) {
  return tile.evaluate(el => {
    const plot = [...el.querySelectorAll('svg')].sort((a,b) => +b.getAttribute('height') - +a.getAttribute('height'))[0];
    const n = el.gridstackNode;
    return { w:n.w,h:n.h,width:+plot.getAttribute('width'),height:+plot.getAttribute('height') };
  });
}
async function drag(page, tile, dx, dy, release = true) {
  await tile.hover();
  const box = await tile.locator('.ui-resizable-se').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x,y); await page.mouse.down();
  if (!release) await page.evaluate(()=>window.resizeStarted=performance.now());
  await page.mouse.move(x+dx,y+dy,{steps:8});
  if (release) await page.mouse.up();
  return {x:x+dx,y:y+dy};
}

test('fresh placement, compact headings and measured chart frames at all editor widths', async ({page}, info) => {
  await ready(page);
  const layout = await saved(page);
  expect(layout.version).toBe(4); expect(layout.rowHeight).toBe(24);
  expect(layout.tiles.map(t=>[t.x,t.y,t.w,t.h])).toEqual([[0,0,12,13],[0,13,6,16],[6,13,6,16],[0,29,4,20],[4,29,8,20]]);
  expect(await page.locator('.tile .db-chart-title').count()).toBe(0);
  for (const width of [1440,1160,1024]) {
    await page.setViewportSize({width,height:width===1440?900:768});
    await page.waitForTimeout(200);
    const bounds = await page.locator('.tile-chart').evaluateAll(es=>es.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight})));
    for (const b of bounds) expect(b.scroll).toBeLessThanOrEqual(b.width+1);
    for (const b of bounds) expect(b.scrollHeight).toBeLessThanOrEqual(b.height+1);
    await page.screenshot({path:`docs/diagnostics/layout-resize-2026-10-01/verified-${width}.png`,fullPage:true});
  }
  await page.locator('.tile-settings summary').nth(1).click();
  await expect(page.locator('[gs-id="import-1"]').getByLabel('X label / unit')).toBeVisible();
});

test('SQL panel stays inside the viewport after tab expansion, results and viewport changes', async ({page}) => {
  await page.setViewportSize({width:1160,height:884});
  await ready(page);
  await page.locator('[gs-id="import-1"] .tile-data-btn').click();
  await page.getByRole('button',{name:'SQL',exact:true}).click();
  const pop=page.locator('.data-popover');
  const inside=async()=>pop.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return r.top>=7 && r.bottom<=innerHeight-7 && r.left>=7 && r.right<=innerWidth-7;
  });
  await expect.poll(inside).toBe(true);
  await expect(page.locator('.data-sql-run')).toBeEnabled({timeout:30000});
  await page.locator('.data-sql-run').click();
  const apply=page.getByRole('button',{name:'Apply to tile',exact:true});
  await expect(apply).toBeEnabled();
  await expect.poll(inside).toBe(true);
  await page.setViewportSize({width:1024,height:768});
  await expect.poll(inside).toBe(true);
  const box=await apply.boundingBox();
  expect(box.y+box.height).toBeLessThanOrEqual(768);
  await apply.click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('[gs-id="import-1"] .tile-data-btn')).toContainText('Query 1');
  await page.locator('[gs-id="import-1"] .tile-data-btn').click();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});

test('live pointer resize redraws before release and manual geometry survives reload, present and data changes', async ({page},info) => {
  await ready(page);
  const tile = page.locator('[gs-id="import-1"]');
  const before = await dimensions(tile);
  await tile.evaluate((el, originalWidth) => {
    const chart=el.querySelector('.tile-chart');
    window.resizeSamples=[];
    new MutationObserver(()=> {
      const plot=chart.querySelector('svg');
      if (plot && +plot.getAttribute('width') !== originalWidth) window.resizeSamples.push(performance.now());
    }).observe(chart,{childList:true,subtree:true});
  }, before.width);
  const end = await drag(page,tile,115,72,false);
  await expect.poll(async()=> (await dimensions(tile)).width).toBeGreaterThan(before.width);
  const during=await dimensions(tile);
  const firstRedrawMs=await page.evaluate(()=>window.resizeSamples[0]-window.resizeStarted);
  expect(firstRedrawMs).toBeGreaterThanOrEqual(0);
  expect(firstRedrawMs).toBeLessThan(100);
  expect(during.height).toBeGreaterThan(before.height);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const after=await dimensions(tile);
  await page.mouse.move(end.x+170,end.y+80); await page.waitForTimeout(80);
  expect(await dimensions(tile)).toEqual(after);
  const layout=await saved(page);
  expect(layout.tiles[1].sizing).toBe('manual');
  await page.reload(); await expect(tile.locator('svg').first()).toBeVisible();
  expect(await dimensions(tile)).toEqual(after);
  await page.locator('#btn-present').click();
  const presented=await dimensions(tile); expect([presented.w,presented.h]).toEqual([after.w,after.h]);
  await page.locator('#btn-exit-present').click();
  await tile.locator('.tile-data-btn').click();
  await page.getByRole('button', {name:'Dashboard default (Tile samples)',exact:true}).click();
  expect((await saved(page)).tiles[1].h).toBe(after.h);
  await tile.locator('.tile-settings summary').click();
  await tile.getByLabel('X label / unit').fill('USD'); await tile.getByLabel('X label / unit').press('Tab');
  expect((await saved(page)).tiles[1].h).toBe(after.h);
  await tile.getByRole('button',{name:'Fit content'}).click();
  await expect.poll(async()=> (await saved(page)).tiles[1].sizing).toBe('auto');
  await page.reload(); expect((await saved(page)).tiles[1].sizing).toBe('auto');
  await fs.writeFile('docs/diagnostics/layout-resize-2026-10-01/pointer-result.json',JSON.stringify({before,during,after,firstRedrawMs},null,2));
});

test('outside mouseup, rapid consecutive gestures and Escape leave no attached resize', async ({page}) => {
  await ready(page);
  const tile=page.locator('[gs-id="import-1"]');
  await drag(page,tile,90,50,false);
  await page.mouse.move(1438,898); await page.mouse.up(); await page.waitForTimeout(100);
  let after=await dimensions(tile);
  await page.mouse.move(500,400); await page.waitForTimeout(80); expect(await dimensions(tile)).toEqual(after);
  await drag(page,tile,-90,-48); await drag(page,tile,90,48);
  await drag(page,tile,40,24,false); await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(100);
  after=await dimensions(tile); await page.mouse.move(600,500); await page.waitForTimeout(80); expect(await dimensions(tile)).toEqual(after);
  expect(await page.locator('.ui-resizable-resizing').count()).toBe(0);
});

test('legacy geometry, user template and offline HTML preserve row contract', async ({page,browser}) => {
  await ready(page);
  const legacy={app:'dashboard-builder',version:1,tiles:[{id:'old',type:'bar',title:'Legacy',dataset:'categorical',x:2,y:0,w:6,h:5}]};
  await page.locator('#file-import').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await expect(page.locator('#status')).toContainText('Imported');
  const current=await saved(page); expect(current.tiles[0].h).toBe(15); expect(current.tiles[0].x).toBe(2);
  const templates=await page.evaluate(async tiles=>{
    const {saveUserTemplate,loadUserTemplates}=await import('/src/templates.js');
    saveUserTemplate('Rows',tiles); return loadUserTemplates();
  },current.tiles);
  expect(templates.at(-1).tiles[0].h).toBe(15);
  expect(templates.at(-1).rowHeight).toBe(24);
  const dl=page.waitForEvent('download'); await page.locator('#btn-export-html').click();
  const file=await dl, html=await fs.readFile(await file.path(),'utf8');
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:900}});
  const viewer=await context.newPage(); await viewer.setContent(html); await expect(viewer.locator('.export-tile svg').first()).toBeVisible();
  expect(await viewer.locator('.export-tile').evaluate(e=>e.getBoundingClientRect().height)).toBe(336);
  await viewer.emulateMedia({media:'print'}); await viewer.pdf({path:'docs/diagnostics/layout-resize-2026-10-01/verified-print.pdf'});
  await context.close();
});
