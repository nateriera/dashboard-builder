import { test, expect } from '@playwright/test';
import { clickHeaderAction } from './header-actions.js';

// Exemplar pass: the starter and every built-in template load in their end
// state — every tile rendered, no tile errors, zero console errors at load.

const TEMPLATES = [
  ['Homeless system performance (CoC)', 5],
  ['Behavioral health quality (CCBHC)', 6],
  ['Health center quality (UDS)', 5],
  ['Overdose & SUD community surveillance', 6],
  ['Community health by place', 6],
  ['Program outcomes & funder report', 4],
  ['System flow: inflow, outflow & actively homeless', 5],
  ['City services: 311 operations', 6],
  ['Performance scorecard (targets & thresholds)', 4],
  ['Executive overview', 5],
  ['Sales performance', 6]
];

function collectErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

async function everyTileRendered(page, count) {
  await expect(page.locator('.tile')).toHaveCount(count);
  await expect.poll(() => page.locator('.tile').evaluateAll(tiles => tiles.every(t => t.querySelector('svg, .db-kpi-value, .db-data-table, .db-annotation')))).toBe(true);
  await expect(page.locator('.tile-error')).toHaveCount(0);
}

test('starter: a Meridian County community-services overview renders at load with zero console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await everyTileRendered(page, 6);
  const titles = await page.locator('.tile [aria-label="Tile title"]').evaluateAll(inputs => inputs.map(i => i.value));
  expect(titles[0]).toBe('Meridian County services: 311 timeliness below goal, homelessness edging down');
  expect(titles).not.toContain('Rent burden vs. homelessness rate'); // no cross-domain scatter
  await expect(page.locator('.db-kpi')).toHaveCount(4);
  expect(errors).toEqual([]);
});

for (const [name, tiles] of TEMPLATES) {
  test(`template "${name}" applies in its end state with zero console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('#status')).toContainText(/Starter dashboard loaded|Layout restored from this browser/);
    await clickHeaderAction(page, '#btn-templates');
    const card = page.locator('.tpl-card').filter({ has: page.getByText(name, { exact: true }) });
    await card.getByRole('button', { name: 'Use template' }).click();
    await card.getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('#status')).toContainText(`Applied template “${name}”.`);
    await everyTileRendered(page, tiles);
    expect(errors).toEqual([]);
  });
}
