// Explicit fixture: the pre-exemplar starter dashboard (main @ c91e425).
//
// Many specs exercise unrelated features (wrangling, resize, DuckDB loading,
// brushing) against whatever the starter happened to contain: a "Headlines"
// KPI row, "Requests by category" bar, "Monthly requests" line, a donut and
// a scatter on the generic samples. The exemplar pass rebuilt the starter as
// a Meridian County overview, so those specs now seed this layout through the
// app's own autosave key instead of depending on the starter implicitly.
// Their assertions are unchanged.
//
// Seeded only when no layout is stored yet, so reloads inside a spec keep the
// spec's own edits (the same as a returning user).

const LAYOUT_KEY = 'dashboard-builder:layout:v1';

export const LEGACY_STARTER = {
  app: 'dashboard-builder',
  version: 3, rowHeight: 24,
  tiles: [
    { type: 'kpi', title: 'Headlines', dataset: 'kpis', x: 0, y: 0, w: 12, h: 13, binding: { mode: 'explicit', ref: 'kpis' } },
    { type: 'bar', title: 'Requests by category', dataset: 'categorical', x: 0, y: 13, w: 6, h: 16, binding: { mode: 'explicit', ref: 'categorical' } },
    { type: 'line', title: 'Monthly requests', dataset: 'timeseries', x: 6, y: 13, w: 6, h: 16, binding: { mode: 'explicit', ref: 'timeseries' } },
    { type: 'donut', title: 'Share of requests', dataset: 'categorical', x: 0, y: 29, w: 4, h: 20, binding: { mode: 'explicit', ref: 'categorical' } },
    { type: 'scatter', title: 'Rent burden vs. homelessness rate', dataset: 'scatter', x: 4, y: 29, w: 8, h: 20, binding: { mode: 'explicit', ref: 'scatter' } }
  ]
};

export async function seedLegacyStarter(page) {
  await page.addInitScript(([key, layout]) => {
    try { if (localStorage.getItem(key) === null && !sessionStorage.getItem('legacy-starter-seeded')) { localStorage.setItem(key, layout); sessionStorage.setItem('legacy-starter-seeded', '1'); } } catch { /* storage blocked: spec will see the real starter */ }
  }, [LAYOUT_KEY, JSON.stringify(LEGACY_STARTER)]);
}
