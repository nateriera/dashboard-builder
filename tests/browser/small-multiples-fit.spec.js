import { test, expect } from '@playwright/test';
import { clickHeaderAction } from './header-actions.js';

test.use({ viewport: { width: 1280, height: 800 } });

for (const [name, count] of [['Homeless system performance (CoC)', 2], ['Program outcomes & funder report', 3]]) {
  test(`S5: ${name} preserves panel widths, heights and one comparison row`, async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored/);
    if (await page.locator('.first-run-hint').isVisible()) await page.getByRole('button', { name: 'Got it' }).click();
    await clickHeaderAction(page, '#btn-templates');
    const card = page.locator('.tpl-card').filter({ has: page.getByText(name, { exact: true }) });
    await card.getByRole('button', { name: 'Use template' }).click();
    await card.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Applied template');
    await page.evaluate(() => document.fonts.ready);
    const results = [];
    for (const state of ['edit', 'compose', 'present']) {
      // Compose follows the S4 census convention: the editor canvas with a
      // simulated closed palette. Exercise both palette widths in every mode.
      if (state === 'present') await clickHeaderAction(page, '#btn-present');
      for (const palette of ['open', 'closed']) {
        const style = await page.addStyleTag({ content: `body #palette { display:${palette === 'open' ? 'block' : 'none'} !important }` });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        const region = page.getByRole('region', { name: 'Small multiples panels', exact: true });
        await expect(region).toBeVisible();
        const probe = () => region.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          const panels = [...el.querySelectorAll('.db-facet')].map(panel => {
            const r = panel.getBoundingClientRect();
            const svg = panel.querySelector('svg').getBoundingClientRect();
            return { width: r.width, height: r.height, chartHeight: svg.height, top: r.top };
          });
          return { panels, outerOverflow: el.parentElement.scrollWidth > el.parentElement.clientWidth + 1,
            scrolls: el.scrollWidth > el.clientWidth, viewportWidth: bounds.width };
        });
        await expect.poll(async () => {
          const r = await probe();
          return r.panels.length === count && r.panels.every(p => p.width >= 244 && p.chartHeight >= 100 && Math.abs(p.top-r.panels[0].top)<1) && !r.outerOverflow;
        }, { message: `${state}, palette ${palette}` }).toBe(true);
        const measurements = await probe();
        results.push({ state, palette, ...measurements });
        if (measurements.scrolls) {
          await expect(page.locator('.db-facets-scroll-hint')).toBeVisible();
          await region.focus();
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
          // Every panel, including the last one, is reachable inside the region.
          await region.evaluate(el => { el.scrollLeft = el.scrollWidth; });
          await expect.poll(() => region.evaluate(el => el.querySelector('.db-facet:last-child').getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)).toBe(true);
        }
        await style.evaluate(el => el.remove());
      }
    }
    await testInfo.attach('panel-measurements', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  });
}
