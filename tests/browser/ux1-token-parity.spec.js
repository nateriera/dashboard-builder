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
