// Capture genuine local browser interactions; encode frames with scripts/encode-demo.py.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'output/readme-polish';
await mkdir(`${out}/frames`, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1160, height: 884 } });
let index = 0;
const frames = [];
async function shot(duration=500) {
  const path = `${out}/frames/${String(index++).padStart(4,'0')}.png`;
  await page.screenshot({path}); frames.push({path,duration});
}
try {
  await page.goto('http://127.0.0.1:4175');
  await page.locator('[gs-id="import-1"] svg').first().waitFor();
  await shot(1800);
  const tile = page.locator('[gs-id="import-1"]');
  const before = await tile.evaluate(e=>({x:e.gridstackNode.x,y:e.gridstackNode.y,w:e.gridstackNode.w,h:e.gridstackNode.h}));
  const handle = await tile.locator('.tile-toolbar').boundingBox();
  await page.mouse.move(handle.x+5,handle.y+handle.height/2); await page.mouse.down();
  for(let i=1;i<=12;i++){await page.mouse.move(handle.x+5+75*i/12,handle.y+handle.height/2+48*i/12);await shot(80);}
  await page.mouse.up(); await page.waitForTimeout(500); await shot(1400);
  await tile.hover();
  const resize = await tile.locator('.ui-resizable-se').boundingBox();
  await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();
  for(let i=1;i<=10;i++){await page.mouse.move(resize.x+resize.width/2-100*i/10,resize.y+resize.height/2+48*i/10);await shot(80);}
  await page.mouse.up();await page.waitForTimeout(400);await shot(1400);
  const after = await tile.evaluate(e=>({x:e.gridstackNode.x,y:e.gridstackNode.y,w:e.gridstackNode.w,h:e.gridstackNode.h}));
  if(before.x===after.x && before.y===after.y) throw Error('Drag did not change position');
  if(before.w===after.w && before.h===after.h) throw Error('Resize did not change geometry');
  await tile.locator('.tile-data-btn').click();await shot(1200);
  await page.getByRole('button',{name:'SQL',exact:true}).click();
  await page.locator('.data-sql-run').waitFor();
  await page.getByLabel('SQL query').fill('SELECT label, value FROM categorical ORDER BY value DESC LIMIT 5');await shot(2200);
  await page.locator('.data-sql-run').click();
  const apply = page.getByRole('button',{name:'Apply to tile',exact:true});
  await apply.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.data-sql-run')?.disabled,{timeout:60000});
  if(!await apply.isEnabled()) throw Error('SQL Apply not enabled');
  await shot(2200);await apply.click();await page.waitForTimeout(400);await shot(1800);
  const downloadPromise=page.waitForEvent('download');await page.locator('#btn-export-html').click();
  const download=await downloadPromise;await download.saveAs(`${out}/demo-export.html`);await shot(1800);
  await writeFile(`${out}/capture.json`,JSON.stringify({before,after,query:'SELECT label, value FROM categorical ORDER BY value DESC LIMIT 5',export:download.suggestedFilename(),frames},null,2));
  for(const name of ['Executive overview','Trend deep dive','Geographic snapshot']) {
    await page.locator('#btn-templates').click();
    const card=page.locator('.tpl-card').filter({has:page.locator('.tpl-card-name',{hasText:name})});
    await card.getByRole('button',{name:'Use template',exact:true}).click();
    await card.getByRole('button',{name:'Replace',exact:true}).click();
    await page.waitForTimeout(700);
    await page.screenshot({path:`docs/screenshots/template-${name.toLowerCase().replaceAll(' ','-')}.png`,fullPage:true});
  }
} finally {await browser.close();}
