import {test,expect} from '@playwright/test';
import {clickHeaderAction} from './header-actions.js';
import {axisFitProbe} from './axis-fit-checks.js';

test.use({viewport:{width:1280,height:800}});
test('S6: starter and all templates keep whole axis titles and legible ticks in every mode and palette width',async({page},testInfo)=>{
 test.setTimeout(240000);
 const records=[];
 await page.goto('/');
 await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
 if(await page.locator('.first-run-hint').isVisible()) await page.getByRole('button',{name:'Got it'}).click();
 await clickHeaderAction(page,'#btn-templates');
 await expect(page.locator('.tpl-card-name')).toHaveCount(11);
 const names=['Starter',...await page.locator('.tpl-card-name').allTextContents()];
 await page.getByRole('button',{name:'Close templates',exact:true}).click();
 for(const name of names){
  if(name!=='Starter'){
   await clickHeaderAction(page,'#btn-templates');
   const card=page.locator('.tpl-card').filter({has:page.getByText(name,{exact:true})});
   await card.getByRole('button',{name:'Use template'}).click();
   await card.getByRole('button',{name:'Replace',exact:true}).click();
   await expect(page.locator('#status')).toContainText('Applied template');
  }
  await page.evaluate(()=>document.fonts.ready);
  for(const state of ['edit','compose','present']){
   // Compose uses the S4/S5 canvas simulation; test both palette widths.
   if(state==='present') await clickHeaderAction(page,'#btn-present');
   for(const palette of ['open','closed']){
    const style=await page.addStyleTag({content:`body #palette{display:${palette==='open'?'block':'none'} !important}`});
    await page.evaluate(async()=>{
     window.dispatchEvent(new Event('resize'));
     for(let frame=0;frame<4;frame++) await new Promise(resolve=>requestAnimationFrame(resolve));
    });
    const tiles=page.locator('.tile');
    const inspect=()=>tiles.evaluateAll(axisFitProbe);
    await expect.poll(async()=>(await inspect()).flatMap(t=>t.problems),{message:`${name}: ${state}, palette ${palette}`}).toEqual([]);
    records.push({name,state,palette,tiles:await inspect()});
    await testInfo.attach(`${names.indexOf(name)}-${state}-${palette}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
    await style.evaluate(el=>el.remove());
   }
  }
  await page.locator('#btn-exit-present').click();
 }
 await testInfo.attach('title-tick-measurements',{body:JSON.stringify(records,null,2),contentType:'application/json'});
});
