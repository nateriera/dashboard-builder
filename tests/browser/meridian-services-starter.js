// Explicit fixture: the Meridian County services starter that was the app's
// default first screen until the launch-polish slice (main @ 604ddf8): a KPI
// strip, the 311 daily area, the homeless count line, the household-group
// bar, the 311 dot plot and an "About this dashboard" note.
//
// The default is now the Meridian County homeless-response dashboard
// (src/data/starterDashboard.json). Specs that exercise unrelated features
// against what the old starter happened to contain (its KPI strip, its
// flowByGroup bar, its tile count) seed this layout through the app's own
// autosave key instead of depending on the default. Their assertions are
// unchanged. The tile list below is the old starterLayout() literal, verbatim.
//
// Seeded only when no layout is stored yet, so reloads inside a spec keep the
// spec's own edits (the same as a returning user).

const LAYOUT_KEY = 'dashboard-builder:layout:v1';

export const MERIDIAN_SERVICES_STARTER = {
  app: "dashboard-builder",
  version: 3, rowHeight: 24,
  tiles: [
    { type: "kpi", title: "Meridian County services: 311 timeliness below goal, homelessness edging down", source: "", dataset: "starterKpis", x: 0, y: 0, w: 12, h: 11, binding: {mode:"explicit",ref:"starterKpis"} },
    { type: "area", title: "311: closures trail openings", source: "", dataset: "cs311Daily", x: 0, y: 11, w: 3, h: 19, tileOptions: { yLabel: "Requests per day" }, binding: {mode:"explicit",ref:"cs311Daily"} },
    { type: "line", title: "Homeless: peak 1,709, falling", source: "", dataset: "flowActive", x: 3, y: 11, w: 3, h: 19, tileOptions: { yLabel: "People actively homeless" }, binding: {mode:"explicit",ref:"flowActive"} },
    { type: "bar", title: "Single adults are half", source: "", dataset: "flowByGroup", x: 6, y: 11, w: 3, h: 19, tileOptions: { sort: "data" }, binding: {mode:"explicit",ref:"flowByGroup"} },
    { type: "dot", title: "311 medians beat every target", source: "", dataset: "cs311CloseVsTarget", x: 9, y: 11, w: 3, h: 19, tileOptions: { sort: "desc", referenceValue: 100, referenceLabel: "Target", xLabel: "Median days to close, % of target" }, binding: {mode:"explicit",ref:"cs311CloseVsTarget"} },
    { type: "text", title: "About this dashboard", x: 0, y: 30, w: 12, h: 5, tileOptions: { body: "A starter built from two of Meridian County's systems: 311 service requests (Jun 4 – Oct 31, 2026) and the homeless response system's monthly by-name list (September 2026 is provisional). Open Templates for the full 311, system-flow and CoC dashboards, or replace any chart's data with your own.\nMeasures: 311 days to close against type-specific targets; HUD System Performance Measure M7b.1; actively homeless by month · Synthetic data for Meridian County, a fictitious jurisdiction." }, binding: {mode:"none"} }
    ]};

export async function seedMeridianServicesStarter(page) {
  await page.addInitScript(([key, layout]) => {
    try { if (localStorage.getItem(key) === null && !sessionStorage.getItem('meridian-services-starter-seeded')) { localStorage.setItem(key, layout); sessionStorage.setItem('meridian-services-starter-seeded', '1'); } } catch { /* storage blocked: spec will see the real default */ }
  }, [LAYOUT_KEY, JSON.stringify(MERIDIAN_SERVICES_STARTER)]);
}
