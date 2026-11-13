import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {clickHeaderAction,shareHtml} from './header-actions.js';

const payloadOf=html=>JSON.parse(html.match(/<script id="dashboard-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const withPayload=(html,payload)=>html.replace(/(<script id="dashboard-data" type="application\/json">)[\s\S]*?(<\/script>)/,()=>`<script id="dashboard-data" type="application/json">${JSON.stringify(payload).replace(/</g,'\\u003c')}</script>`);
async function exportStarter(page){
 await page.goto('/');await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
 if(await page.locator('.first-run-hint').isVisible())await page.getByRole('button',{name:'Got it'}).click();
 await clickHeaderAction(page,'#btn-save');
 await page.evaluate(()=>{
  const key='dashboard-builder:layout:v1',layout=JSON.parse(localStorage.getItem(key));
  const bar=layout.tiles.find(t=>t.dataset==='flowByGroup');
  const values=['Single adults','Families','Youth 18–24','Veterans','Not recorded'];
  layout.filters=[{id:'filter-households',field:'label',op:'is',values,scope:'charts',targets:[{tileId:bar.id,field:'label'}]}];
  layout.parameters=[{name:'households',type:'multi-select',value:values,source:{dataset:'flowByGroup',column:'label'},options:values,bindings:[{kind:'filter',filterId:'filter-households'}]}];
  localStorage.setItem(key,JSON.stringify(layout));
 });
 await page.reload();await expect(page.locator('#status')).toContainText('Layout restored');
 page.on('dialog',dialog=>dialog.accept());
 const pending=page.waitForEvent('download');
 await shareHtml(page,{'Dashboard title':'Meridian County services at a glance','Prepared by':'Dashboard Builder sample','Data period':'October 2023 – October 2026'});
 return fs.readFile(await(await pending).path(),'utf8');
}
async function loaded(page,html){await page.setContent(html);await expect(page.locator('.export-tile svg').first()).toBeVisible();await page.evaluate(()=>document.fonts.ready);}
async function geometry(page){return page.evaluate(()=>{
 const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return {root:rect('#export-root'),head:rect('.export-head'),card:rect('.export-filters'),grid:rect('.export-grid'),display:getComputedStyle(document.querySelector('#export-root')).display};
});}
async function columns(page){
 await expect.poll(async()=>{const r=await geometry(page);return !!r.card&&Math.abs(r.head.y-r.card.y)<1&&r.card.x>=r.head.right+31&&Math.abs(r.card.right-(r.root.right-24))<1&&r.grid.y>=Math.max(r.head.bottom,r.card.bottom)+11;}).toBe(true);
}

test('export head: starter single-filter card fills the right column at wide widths and stacks below 1000px',async({page,context},testInfo)=>{
 const html=await exportStarter(page),payload=payloadOf(html);
 expect(payload.kind).toBe('dashboard-export');expect(payload.version).toBe(5);expect(payload.filters).toHaveLength(1);
 const viewer=await context.newPage();await loaded(viewer,html);
 const observations=[];
 for(const [width,height]of[[1920,1080],[1280,800],[1000,800]]){
  await viewer.setViewportSize({width,height});await columns(viewer);
  await expect(viewer.locator('.export-filters')).toHaveCSS('border-top-width','1px');
  observations.push({width,height,...await geometry(viewer)});
  await testInfo.attach(`after-${width}x${height}`,{body:await viewer.screenshot(),contentType:'image/png'});
  if(width>=1280)await testInfo.attach(`after-${width}x${height}-head`,{body:await viewer.screenshot({clip:{x:0,y:0,width,height:500}}),contentType:'image/png'});
 }
 for(const width of [999,360]){
  await viewer.setViewportSize({width,height:800});
  await expect.poll(async()=>{const r=await geometry(viewer);return r.display==='block'&&r.card.y>=r.head.bottom&&r.card.x>=0&&r.card.right<=width;}).toBe(true);
 }
 await viewer.setViewportSize({width:1280,height:800});await columns(viewer);
 const control=viewer.getByLabel('households',{exact:true});
 await control.selectOption(['Families']);
 const barId=payload.filters[0].targets[0].tileId;
 await expect.poll(()=>viewer.locator(`[data-tile-id="${barId}"] .chart-data summary`).textContent()).toContain('(1 rows)');
 await viewer.getByRole('button',{name:'Restore exported filters'}).click();
 await expect.poll(()=>control.evaluate(el=>el.selectedOptions.length)).toBe(5);
 await expect(viewer.getByRole('button',{name:'Restore exported filters'})).toBeDisabled();
 await viewer.emulateMedia({media:'print'});
 await expect(viewer.locator('.export-filters')).toBeHidden();
 expect((await geometry(viewer)).display).toBe('block');
 await expect(viewer.locator('.export-print-filters')).toBeVisible();
 await testInfo.attach('head-geometry',{body:JSON.stringify({payloadKeys:Object.keys(payload),barId,observations},null,2),contentType:'application/json'});
});

test('export head: no-filter head takes full width; several filters grow the card without overflow',async({page})=>{
 const html=await exportStarter(page),payload=payloadOf(html);
 await page.setViewportSize({width:1280,height:800});
 const empty={...payload,filters:[],parameters:[]};
 await loaded(page,withPayload(html,empty));
 await expect(page.locator('.export-filters')).toHaveCount(0);
 const r=await geometry(page);expect(r.display).toBe('block');expect(r.head.width).toBeCloseTo(r.root.width-48,0);
 const barId=payload.filters[0].targets[0].tileId;
 await page.locator(`[data-tile-id="${barId}"] svg [aria-label^="Category: "]`).first().click();
 await columns(page);
 await page.getByRole('button',{name:'Restore exported filters'}).click();
 await expect(page.locator('.export-filters')).toHaveCount(0);
 expect((await geometry(page)).display).toBe('block');
 const many={...payload,filters:[...payload.filters,{id:'range',field:'value',op:'between',values:[0,900],scope:'charts',targets:[{tileId:barId,field:'value'}]},{id:'categories',field:'label',op:'is',values:['Families','Veterans'],scope:'charts',targets:[{tileId:barId,field:'label'}]}]};
 await loaded(page,html);await columns(page);const single=(await geometry(page)).card.height;
 await loaded(page,withPayload(html,many));await columns(page);
 await expect(page.locator('.export-filter-controls > .export-filter')).toHaveCount(3);
 expect((await geometry(page)).card.height).toBeGreaterThan(single);
 expect(await page.locator('.export-filters').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.setViewportSize({width:360,height:800});
 expect(await page.locator('.export-filters').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
