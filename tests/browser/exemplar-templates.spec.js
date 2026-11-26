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
  ['Sales performance', 6],
  // CoC edition (Stage 1b), its own gallery section.
  ['Board packet (CoC edition)', 8],
  ['Funder report (CoC edition)', 5]
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

// The default first screen is the Meridian County homeless-response dashboard
// (src/data/starterDashboard.json; launch-polish slice). It replaced the
// community-services overview this test pinned before: 6 tiles, a KPI strip.
test('starter: the Meridian County homeless-response dashboard renders at load with zero console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Starter dashboard loaded');
  await everyTileRendered(page, 5);
  const titles = await page.locator('.tile [aria-label="Tile title"]').evaluateAll(inputs => inputs.map(i => i.value));
  expect(titles).toEqual([
    'Peak 1,709 (Jan 2025); a second rise in early 2026',
    'Single adults are half of entries',
    'What if more people moved into housing each month?',
    'Entries and exits trade places',
    'About this dashboard'
  ]);
  expect(titles).not.toContain('Rent burden vs. homelessness rate'); // no cross-domain scatter
  await expect(page.locator('.db-kpi')).toHaveCount(0);
  await expect(page.locator('.db-donut')).toContainText('8,202');
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
