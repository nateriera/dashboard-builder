import { test, expect } from '@playwright/test';
import { clickHeaderAction } from './header-actions.js';
import { tableFitProbe } from './table-fit-checks.js';

test.use({viewport:{width:1280,height:800}});
const templates=['Homeless system performance (CoC)','Behavioral health quality (CCBHC)','City services: 311 operations','Performance scorecard (targets & thresholds)'];

for(const name of templates) test(`S4: ${name} keeps all table columns and rows reachable in edit, compose and present`,async({page})=>{
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
  if(await page.locator('.first-run-hint').isVisible())await page.getByRole('button',{name:'Got it'}).click();
  await clickHeaderAction(page,'#btn-templates');
  const card=page.locator('.tpl-card').filter({has:page.getByText(name,{exact:true})});
  await card.getByRole('button',{name:'Use template'}).click();
  await card.getByRole('button',{name:'Replace',exact:true}).click();
  await expect(page.locator('#status')).toContainText('Applied template');
  await page.evaluate(()=>document.fonts.ready);
  let hiddenPalette;
  for(const state of ['edit','compose','present']) {
    if(state==='compose') {
      hiddenPalette=await page.addStyleTag({content:'#palette {display:none !important}'});
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    }
    if(state==='present') {
      await hiddenPalette.evaluate(el=>el.remove());
      await clickHeaderAction(page,'#btn-present');
    }
    const region=page.locator('.db-data-table-scroll');
    await expect(region).toBeVisible();
    await expect.poll(async()=>{
      const r=await region.evaluate(tableFitProbe);
      return {problems:r.problems,truncated:r.truncated,regionInside:r.regionInside,hintVisible:r.hintVisible,keyboardFocusable:r.keyboardFocusable,lastRowVisible:r.lastRowVisible,outerX:r.outerX,outerY:r.outerY};
    },{message:`${name}, ${state}`}).toEqual({problems:[],truncated:[],regionInside:true,hintVisible:true,keyboardFocusable:true,lastRowVisible:true,outerX:0,outerY:0});
    await expect.poll(async()=>(await region.evaluate(tableFitProbe)).minFont).toBeGreaterThanOrEqual(11);
    if(name.startsWith('Performance scorecard'))await expect.poll(async()=>(await region.evaluate(tableFitProbe)).statusVisible).toBe(true);
    // Native keyboard scrolling must work without having to find a scrollbar.
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  }
  if(name==='Homeless system performance (CoC)') {
    await page.locator('#btn-exit-present').click();
    const tile=page.locator('.tile').filter({has:page.locator('.db-data-table-scroll')});
    await tile.getByLabel('Chart settings',{exact:true}).click();
    await tile.getByRole('button',{name:'Fit content',exact:true}).click();
    await expect(tile.locator('.db-data-table')).toHaveClass(/db-data-table-auto/);
    await expect.poll(()=>tile.locator('.db-data-table-scroll').evaluate(el=>el.scrollHeight-el.clientHeight)).toBe(0);
  }
});
