import {test,expect} from '@playwright/test';
import {clickHeaderAction} from './header-actions.js';
import {paletteTitleProbe} from './palette-title-checks.js';

test.use({viewport:{width:1280,height:800}});
async function ready(page){
 await page.goto('/');await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
 if(await page.locator('.first-run-hint').isVisible())await page.getByRole('button',{name:'Got it'}).click();
 await page.evaluate(()=>document.fonts.ready);
}
async function settle(page){await page.evaluate(async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>requestAnimationFrame(resolve));});}
async function palette(page,closed){
 const button=page.locator('#btn-palette-toggle');
 if(await button.getAttribute('aria-expanded')!==(closed?'false':'true'))await button.click();
 await expect(button).toHaveAttribute('aria-expanded',closed?'false':'true');await settle(page);
}

test('S7: keyboard palette toggle matches simulated canvas widths and persists across present and reload; titles remain editable',async({page})=>{
 await ready(page);
 const button=page.locator('#btn-palette-toggle');
 await expect(button).toHaveText('Hide charts');
 await expect(button).toHaveAttribute('aria-controls','palette');
 const open=await page.locator('.grid-stack').evaluate(el=>el.clientWidth);
 const simulated=await page.addStyleTag({content:'#palette{display:none!important}'});await settle(page);
 const closed=await page.locator('.grid-stack').evaluate(el=>el.clientWidth);
 await simulated.evaluate(el=>el.remove());await settle(page);
 await button.focus();await page.keyboard.press('Enter');await expect(button).toHaveText('Show charts');
 await expect(page.locator('#palette')).toBeHidden();
 await expect.poll(()=>page.locator('.grid-stack').evaluate(el=>el.clientWidth)).toBe(closed);
 for(const state of ['closed','open']){
  if(state==='open'){await button.focus();await page.keyboard.press('Space');await expect(button).toHaveText('Hide charts');}
  await clickHeaderAction(page,'#btn-present');await expect(button).toBeHidden();
  await page.locator('#btn-exit-present').click();
  await expect(button).toHaveAttribute('aria-expanded',state==='closed'?'false':'true');
  await page.reload();await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
  await expect.poll(()=>page.locator('.grid-stack').evaluate(el=>el.clientWidth)).toBe(state==='closed'?closed:open);
 }
 const title=page.locator('.tile-title:not([hidden])').nth(1);
 const text='Complete editable title with a very long measurement unit: '+ 'UnbrokenUnit'.repeat(7);
 await title.fill(text);await title.press('Tab');await settle(page);
 await clickHeaderAction(page,'#btn-save');
 await expect.poll(async()=>(await page.evaluate(paletteTitleProbe)).titles.filter(t=>t.truncated)).toEqual([]);
 await page.reload();await expect(title).toHaveValue(text);
 await expect.poll(async()=>(await page.evaluate(paletteTitleProbe)).titles.filter(t=>t.truncated)).toEqual([]);
});

test('S7: census titles are whole in both real palette states; all 12 KPI tiles retain their S1 bounds',async({page},testInfo)=>{
 await ready(page);await clickHeaderAction(page,'#btn-templates');
 await expect(page.locator('.tpl-card-name')).toHaveCount(11);
 const names=['Starter',...await page.locator('.tpl-card-name').allTextContents()];
 await page.getByRole('button',{name:'Close templates',exact:true}).click();
 const records=[];
 for(const name of names){
  if(name!=='Starter'){
   await clickHeaderAction(page,'#btn-templates');
   const card=page.locator('.tpl-card').filter({has:page.getByText(name,{exact:true})});
   await card.getByRole('button',{name:'Use template'}).click();await card.getByRole('button',{name:'Replace',exact:true}).click();
   await expect(page.locator('#status')).toContainText('Applied template');
  }
  for(const state of ['open','closed']){
   await palette(page,state==='closed');
   await expect.poll(async()=>{const r=await page.evaluate(paletteTitleProbe);return {clipped:r.titles.filter(t=>t.truncated).map(t=>t.title),kpi:r.kpis.flatMap(k=>k.problems)};},{message:`${name}, ${state}`}).toEqual({clipped:[],kpi:[]});
   const r=await page.evaluate(paletteTitleProbe);
   expect(r.titles.length).toBeGreaterThan(0);expect(r.titles.every(t=>t.fontSize>=14)).toBe(true);
   records.push({name,palette:state,...r});
   await testInfo.attach(`${names.indexOf(name)}-${state}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  }
 }
 for(const state of ['open','closed']){
  expect(records.filter(r=>r.palette===state).flatMap(r=>r.kpis)).toHaveLength(12);
  expect(records.filter(r=>r.palette===state).flatMap(r=>r.titles)).toHaveLength(52);
 }
 await testInfo.attach('title-kpi-measurements',{body:JSON.stringify(records,null,2),contentType:'application/json'});
});
