import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

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
  await expect(page.locator('#status')).toContainText('build');
  await assertPaperFonts(page);
  expect(fontRequests.filter(url => !url.startsWith(new URL(page.url()).origin))).toEqual([]);
  if (process.env.UX1_BUILT) expect(fontRequests).toEqual([]);
  const downloadPromise = page.waitForEvent('download');
  await clickHeaderAction(page, '#btn-export-html');
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
  await expect(page.locator('#status')).toContainText('build');
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

test('Paper export tab selection remains distinct from hover', async ({page,browser}) => {
  await page.goto('/'); await expect(page.locator('#status')).toContainText('build');
  const pending=page.waitForEvent('download'); await clickHeaderAction(page,'#btn-export-html');
  const download=await pending; const context=await browser.newContext({offline:true});
  try {
    const viewer=await context.newPage(); await viewer.setContent(await fs.readFile(await download.path(),'utf8'));
    await viewer.evaluate(() => {const nav=document.createElement('nav'); nav.className='export-page-tabs'; nav.innerHTML='<button>Hover</button><button aria-selected="true">Selected</button>'; document.body.append(nav);});
    const buttons=viewer.locator('.export-page-tabs button'); await buttons.first().hover();
    const colors=await buttons.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
    expect(colors).toEqual(['rgb(231, 227, 217)','rgb(74, 82, 120)']);
  } finally { await context.close(); }
});
