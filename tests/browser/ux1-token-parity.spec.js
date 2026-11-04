import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction, shareHtml } from './header-actions.js';

async function assertPaperFonts(page) {
  const result = await page.evaluate(async () => {
    await Promise.all(['Raleway', 'Inter', 'JetBrains Mono'].map(name => document.fonts.load(`400 16px "${name}"`)));
    await document.fonts.ready;
    return {
      accent: getComputedStyle(document.documentElement).getPropertyValue('--periwinkle').trim(),
      fonts: ['Raleway', 'Inter', 'JetBrains Mono'].map(name => document.fonts.check(`400 16px "${name}"`)),
      faces: [...document.fonts].filter(face => ['Raleway', 'Inter', 'JetBrains Mono'].includes(face.family)).map(face => [face.family, face.status])
    };
  });
  expect(result.accent.toLowerCase()).toBe('#b7bfd9');
  expect(result.fonts).toEqual([true, true, true]);
  const focus = await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Focus check';
    button.style.boxShadow = 'none';
    document.body.append(button);
    button.focus();
    const result = { visible: button.matches(':focus-visible'), shadow: getComputedStyle(button).boxShadow };
    button.remove();
    return result;
  });
  expect(focus.visible).toBe(true);
  expect(focus.shadow).toContain('rgba(183, 191, 217, 0.45)');
  expect(result.faces).toEqual(expect.arrayContaining([['Raleway', 'loaded'], ['Inter', 'loaded'], ['JetBrains Mono', 'loaded']]));
}

test('Paper app and generated export resolve the same bundled fonts and palette', async ({ page, browser }) => {
  const fontRequests = [];
  page.on('request', req => { if (req.resourceType() === 'font') fontRequests.push(req.url()); });
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await assertPaperFonts(page);
  expect(fontRequests.filter(url => !url.startsWith(new URL(page.url()).origin))).toEqual([]);
  if (process.env.UX1_BUILT) expect(fontRequests).toEqual([]);
  const downloadPromise = page.waitForEvent('download');
  await shareHtml(page);
  const download = await downloadPromise;
  const context = await browser.newContext({ offline: true });
  try {
    const exported = await context.newPage();
    const requests = [];
    exported.on('request', req => { if (req.resourceType() === 'font') requests.push(req.url()); });
    await exported.setContent(await fs.readFile(await download.path(), 'utf8'));
    await assertPaperFonts(exported);
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

test('Paper controls show canonical hover, disabled, scrim and tab states', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const item = page.locator('.palette-item').first();
  const borderBefore = await item.evaluate(el => getComputedStyle(el).borderLeftColor);
  await item.hover();
  expect(await item.evaluate(el => getComputedStyle(el).borderLeftColor)).toBe(borderBefore);
  const disabled = await page.evaluate(() => { const b=document.createElement('button'); b.disabled=true; b.className='data-apply'; document.body.append(b); const c=getComputedStyle(b); return [c.opacity,c.cursor]; });
  expect(disabled).toEqual(['0.45','not-allowed']);
  await clickHeaderAction(page, '#btn-templates');
  await expect(page.locator('.tpl-overlay')).toHaveCSS('background-color','rgba(14, 31, 42, 0.45)');
  const states=await page.evaluate(() => {const nav=document.createElement('nav');nav.id='page-tabs';nav.innerHTML='<button>Hover</button><button aria-selected="true">Selected</button>';document.body.append(nav);return [...nav.children].map(x=>getComputedStyle(x).backgroundColor);});
  expect(states[1]).not.toEqual(states[0]);
});

test('Paper export tabs use canonical tokens: slate hover, dusk outline on the targeted page heading (UX-7 V4)', async ({page,browser}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const pending=page.waitForEvent('download'); await shareHtml(page);
  const download=await pending; const context=await browser.newContext({offline:true});
  try {
    const viewer=await context.newPage(); await viewer.setContent(await fs.readFile(await download.path(),'utf8'));
    await viewer.evaluate(() => {const nav=document.createElement('nav'); nav.className='export-page-tabs'; nav.innerHTML='<a href="#page-x">Hover</a><a href="#page-y">Rest</a>'; const heading=document.createElement('h2'); heading.className='export-page-heading'; heading.id='page-x'; heading.textContent='X'; document.body.append(nav, heading);});
    const links=viewer.locator('.export-page-tabs a'); await links.first().hover();
    const colors=await links.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
    expect(colors).toEqual(['rgb(231, 227, 217)','rgb(255, 255, 255)']);
    await links.first().click();
    await expect(viewer.locator('#page-x')).toHaveCSS('outline-color','rgb(74, 82, 120)');
    const css=await viewer.evaluate(()=>[...document.querySelectorAll('style')].map(style=>style.textContent).join('\n'));
    expect(css).not.toMatch(/#d8d2c2|#c9803a/i);
  } finally { await context.close(); }
});

test('Paper changes do not alter Slate states or brush', async ({page}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  const values=await page.evaluate(async () => {
    const {setTheme}=await import('/src/themes/themes.js');
    const holder=document.createElement('div'); holder.innerHTML='<div id="palette"><h2>Chart</h2><button class="palette-item">Item</button></div><div class="guided-actions"><button disabled>Disabled</button></div><div class="tile-chart"><svg><rect class="db-time-brush" width="10" height="10"></rect></svg></div>';
    document.body.append(holder);
    const tab=document.createElement('button'); tab.setAttribute('aria-selected','true'); document.querySelector('#page-tabs').append(tab);
    const capture=() => {const css=x=>getComputedStyle(holder.querySelector(x)); return {size:css('#palette h2').fontSize,radius:css('.palette-item').borderRadius,disabled:css('.guided-actions button').opacity,tab:getComputedStyle(tab).backgroundColor,brush:css('.db-time-brush').fill};};
    setTheme('slate'); const slate=capture(); setTheme('paper'); const paper=capture(); holder.remove(); tab.remove(); return {slate,paper};
  });
  expect(values.slate).toEqual({size:'13px',radius:'8px',disabled:'0.5',tab:'rgba(0, 0, 0, 0)',brush:'rgba(62, 92, 118, 0.14)'});
  expect(values.paper).toEqual({size:'14px',radius:'6px',disabled:'0.45',tab:'rgb(74, 82, 120)',brush:'rgba(183, 191, 217, 0.3)'});
});

test('Export preserves Slate brush and tab styles', async ({page,browser}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
  await page.evaluate(async()=>{(await import('/src/themes/themes.js')).setTheme('slate')});
  const pending=page.waitForEvent('download'); await shareHtml(page); const download=await pending;
  const context=await browser.newContext({offline:true});
  try {const viewer=await context.newPage();await viewer.setContent(await fs.readFile(await download.path(),'utf8'));const result=await viewer.evaluate(()=>{const host=document.createElement('div');host.innerHTML='<div class="tile-chart"><svg><rect class="db-time-brush" width="10" height="10"></rect></svg></div><nav class="export-page-tabs"><a href="#page-x">Tab</a></nav>';document.body.append(host);return {theme:document.documentElement.dataset.theme,brush:getComputedStyle(host.querySelector('.db-time-brush')).fill,tab:getComputedStyle(host.querySelector('.export-page-tabs a')).backgroundColor};});expect(result).toEqual({theme:'slate',brush:'rgba(62, 92, 118, 0.14)',tab:'rgba(0, 0, 0, 0)'});} finally {await context.close();}
});
