import { validateLayout } from "./data/layout.js";
// Template library: original dashboard compositions a user can start from.
//
// IP rule (standing): templates are original compositions built from generic
// BI layout patterns (KPI strip + trend + mix, geo snapshot, scorecard…).
// Study published dashboards for structural patterns only; never close
// recreations. If a template ever draws on a specific published dashboard,
// set its `inspiredBy` to { name, url } — attribution is credit, not
// permission, so ask the creator before anything close.
//
// A template is layout JSON:
//   { id, name, description, inspiredBy, tiles: [
//       { type, x, y, w, h, title, dataset, tileOptions? } ] }
// `dataset` is an explicit sample-dataset key so templates render
// deterministically no matter what the dashboard-wide default is.
//
// Exemplar set (Nov 2026): every built-in template is built on its own
// purpose-made datasets from the Meridian County universe (a fictitious
// jurisdiction; see scripts/generate-sample-data.mjs). `description` states
// the template's question; titles state findings; the last tile carries the
// measure-source line. Geometry uses legacy grid units (h × 72px).

import { TILE_TYPES } from "./tiles/registry.js";
import homelessSystemScreenshot from "./assets/template-thumbs/homeless-system-performance.png";
import behavioralHealthScreenshot from "./assets/template-thumbs/behavioral-health-quality.png";
import healthCenterScreenshot from "./assets/template-thumbs/health-center-quality.png";
import overdoseScreenshot from "./assets/template-thumbs/overdose-surveillance.png";
import communityHealthScreenshot from "./assets/template-thumbs/community-health-by-place.png";
import programOutcomesScreenshot from "./assets/template-thumbs/program-outcomes.png";
import systemFlowScreenshot from "./assets/template-thumbs/system-flow.png";
import cityServicesScreenshot from "./assets/template-thumbs/city-services-311.png";
import performanceScorecardScreenshot from "./assets/template-thumbs/performance-scorecard.png";
import executiveOverviewScreenshot from "./assets/template-thumbs/executive-overview.png";
import salesPerformanceScreenshot from "./assets/template-thumbs/sales-performance.png";

const SYNTHETIC = "Synthetic data for Meridian County, a fictitious jurisdiction.";
const note = (x, y, w, h, title, body) => ({ type: "text", x, y, w, h, title, tileOptions: { body } });

export const BUILT_IN_TEMPLATES = [
  {
    id: "homeless-system-performance",
    theme: "paper",
    name: "Homeless system performance (CoC)",
    screenshot: homelessSystemScreenshot,
    description: "Is the homeless response system getting people housed faster, keeping them housed, and doing it equitably?",
    inspiredBy: { name: "HUD System Performance Measures and Stella P (structural pattern only)", url: "https://www.hudexchange.info/programs/coc/system-performance-measures/" },
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "FY2026: shorter stays and fewer returns; exits to housing still short of the 45% goal", dataset: "cocKpis" },
      { type: "smallMultiples", x: 0, y: 4, w: 12, h: 8, title: "Every household type moved through homelessness faster each year since FY2022 (median days)", dataset: "cocDaysByHousehold", tileOptions: { sort: "data" } },
      { type: "bar", x: 0, y: 12, w: 7, h: 7, title: "4 in 10 exits went to housing", dataset: "cocExitDestinations", tileOptions: { sort: "data", xLabel: "Exits, FY2026" } },
      { type: "dot", x: 7, y: 12, w: 5, h: 7, title: "Return early", dataset: "cocReturnsTiming", tileOptions: { sort: "data", xLabel: "% of PH exits who returned" } },
      { type: "histogram", x: 0, y: 19, w: 6, h: 7, title: "A long tail lifts the mean", dataset: "cocLothStays", tileOptions: { binCount: 30, xLabel: "Days homeless per stay (FY2026; median 75.5, mean 167)" } },
      { type: "boxplot", x: 6, y: 19, w: 6, h: 7, title: "Families stay longest", dataset: "cocLothStays", tileOptions: { yLabel: "Days homeless per stay" } },
      { type: "smallMultiples", x: 0, y: 26, w: 12, h: 6, title: "Re-cut by race/ethnicity: Black households exit to housing least often and return most often", dataset: "cocEquity", tileOptions: { sort: "data" } },
      { type: "table", x: 0, y: 32, w: 12, h: 8, title: "System Performance Measures, FY2025 vs FY2026", dataset: "cocSpmTable" },
      note(0, 40, 12, 4, "What the measures say", "Equity: Black households exited to permanent housing at 32.5% vs 47.0% for White households, and returned within 24 months at 17.2% vs 10.2%. Asian and Native Hawaiian/Pacific Islander groups had fewer than 20 exits and are suppressed.\nMix-shift: every household type's median fell, but families (the longest stayers) grew from 11.5% to 28.9% of stays, holding the overall median near flat (76.5 → 75.5 days).\nM6 is absent: it applies only to CoCs approved to serve people homeless under Category 3 of HUD's definition, and Meridian is not one. 4% of exit destinations are unknown (client doesn't know/refused or not collected) and stay visible in the chart.\nMeasures: HUD System Performance Measures (M1–M5, M7), FY2025 definitions · " + SYNTHETIC)
    ]
  },
  {
    id: "behavioral-health-quality",
    theme: "paper",
    name: "Behavioral health quality (CCBHC)",
    screenshot: behavioralHealthScreenshot,
    description: "Are clients getting timely care and getting better, and which sites and measures need attention?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Remission beats benchmark; 30-day follow-up after hospitalization sits just under it", dataset: "bhKpis" },
      { type: "dot", x: 0, y: 4, w: 6, h: 7, title: "7 of 10 meet benchmark", dataset: "bhGapToBenchmark", tileOptions: { sort: "data", referenceValue: 0, referenceLabel: "Benchmark", xLabel: "Points vs benchmark (higher is better)" } },
      { type: "heatmap", x: 6, y: 4, w: 6, h: 8, title: "Northfield lowest, 9 of 10", dataset: "bhHeatmap" },
      { type: "smallMultiples", x: 0, y: 12, w: 12, h: 8, title: "DEP-REM-6 remission rose at Downtown and Riverbend after measurement-based care began (Jul 2025)", dataset: "bhSiteTrends", tileOptions: { sort: "data" } },
      { type: "stackedBar", x: 0, y: 20, w: 12, h: 7, title: "Up to a third of patients never get a 6-month PHQ-9 (% of patients with an index PHQ-9 above 9)", dataset: "bhPhqBands", tileOptions: { mode: "stacked", xLabel: "% of index patients, last 12 months" } },
      { type: "table", x: 0, y: 27, w: 12, h: 8, title: "Every measure: numerator, denominator, rate and benchmark (last 12 months)", dataset: "bhMeasureTable" },
      note(0, 35, 12, 3, "Reading this dashboard", "Paired 7- and 30-day follow-up measures (FUH, FUM, FUA) sit next to each other in the benchmark chart. Benchmarks are illustrative, not published national values. Northfield is the rural mobile site. Quarterly site panels are noisy: each quarter has 60–170 index patients per site.\nMeasures: CCBHC quality measures (I-SERV, DEP-REM-6, FUH, FUM, FUA, SRA) · " + SYNTHETIC)
    ]
  },
  {
    id: "health-center-quality",
    theme: "paper",
    name: "Health center quality (UDS)",
    screenshot: healthCenterScreenshot,
    description: "Is the health center reaching the patients it exists for, and are its clinical quality measures improving?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "28,655 patients, nearly nine in ten low-income; blood-pressure control up again", dataset: "udsKpis" },
      { type: "stackedColumn", x: 0, y: 4, w: 12, h: 7, title: "Four headline measures improved five years running; diabetes poor control fell (lower is better)", dataset: "udsCqmTrend", tileOptions: { mode: "grouped", yLabel: "% of eligible patients" } },
      { type: "dot", x: 0, y: 11, w: 7, h: 7, title: "Beats national on 5 of 10", dataset: "udsVsNational", tileOptions: { sort: "desc", referenceValue: 0, referenceLabel: "National", xLabel: "Points better (+) or worse (−) than national" } },
      { type: "bar", x: 7, y: 11, w: 5, h: 7, title: "61% medical", dataset: "udsServiceLines", tileOptions: { xLabel: "Visits, 2025" } },
      { type: "stackedColumn", x: 0, y: 18, w: 12, h: 7, title: "Medicaid and uninsured patients are two-thirds of the panel every year (% of patients)", dataset: "udsPayerMix", tileOptions: { mode: "stacked", yLabel: "% of patients" } },
      { type: "table", x: 0, y: 25, w: 12, h: 8, title: "All clinical quality measures, 2025 vs 2024", dataset: "udsCqmTable" },
      note(0, 33, 12, 3, "Source", "Diabetes poor control is an inverse measure (lower is better); its gap is shown as national minus centre, so a positive value always means better. National comparators are illustrative.\nMeasures: HRSA Uniform Data System clinical quality measures, calendar years 2021–2025 · " + SYNTHETIC)
    ]
  },
  {
    id: "overdose-surveillance",
    theme: "paper",
    name: "Overdose & SUD community surveillance",
    screenshot: overdoseScreenshot,
    description: "Are overdose deaths falling, what is driving them, and is the response reaching people?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Deaths and nonfatal ED visits are both down from a year ago", dataset: "odKpis" },
      { type: "line", x: 0, y: 4, w: 7, h: 7, title: "Down from 56.2 peak after naloxone", dataset: "odRollingRate", tileOptions: { yLabel: "Deaths per 100k, rolling 12 months" } },
      { type: "area", x: 7, y: 4, w: 5, h: 7, title: "Leads deaths", dataset: "odEdVisits", tileOptions: { yLabel: "Nonfatal ED visits/month (leads deaths)" } },
      { type: "choropleth", x: 0, y: 11, w: 7, h: 6, title: "State rates vary 6.6× (synthetic)", dataset: "odStateRates" },
      { type: "dot", x: 7, y: 11, w: 5, h: 6, title: "Top 15", dataset: "odStateRates", tileOptions: { sort: "desc", topN: 15, xLabel: "Deaths per 100k" } },
      { type: "smallMultiples", x: 0, y: 17, w: 12, h: 8, title: "Fentanyl drives the rise; xylazine appears from 2023 (deaths per 100k by substance; not additive)", dataset: "odBySubstance", tileOptions: { sort: "data" } },
      note(0, 25, 12, 4, "Provisional data and small numbers", "Events: fentanyl became dominant in Apr 2020; xylazine was first detected in Mar 2023; the leave-behind naloxone programme launched in Jul 2024. Nonfatal ED visits are the faster series and move about two months ahead of deaths.\nThe most recent six months are provisional while death certificates are pending, and will rise as records close. Monthly county counts are small (3–25 deaths), so rates are rolling 12-month sums and single months are not compared. One death can involve several substances.\nMeasures: drug overdose deaths per 100,000 residents, nonfatal overdose ED visits, EMS naloxone administrations · " + SYNTHETIC)
    ]
  },
  {
    id: "community-health-by-place",
    theme: "paper",
    name: "Community health by place",
    screenshot: communityHealthScreenshot,
    description: "How does Meridian compare with its state and the nation, and where are the gaps largest?",
    inspiredBy: { name: "County Health Rankings & Roadmaps model (structural pattern only)", url: "https://www.countyhealthrankings.org/" },
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Meridian's premature death rate is 11% above the state and 14% above the U.S.", dataset: "chKpis" },
      { type: "choropleth", x: 0, y: 4, w: 7, h: 6, title: "Uninsured: 3.6% to 23.8% by state", dataset: "chStateRates" },
      { type: "dot", x: 7, y: 4, w: 5, h: 6, title: "Top 15", dataset: "chStateRates", tileOptions: { sort: "desc", topN: 15, xLabel: "% uninsured, adults 19–64" } },
      { type: "smallMultiples", x: 0, y: 10, w: 12, h: 8, title: "Meridian runs above the state and the U.S. on every factor measured (%)", dataset: "chFactors", tileOptions: { sort: "data" } },
      { type: "scatter", x: 0, y: 18, w: 7, h: 6, title: "More uninsured, more early deaths", dataset: "chScatter", tileOptions: { xLabel: "Uninsured adults 19–64 (%)", yLabel: "Premature deaths per 100k" } },
      note(7, 18, 5, 6, "r = 0.81, not causal", "The scatter shows association across states, not effect. Coverage, income, rurality and age structure move together, so a state with more uninsured adults also tends to differ on poverty and access to care.\nUse it to choose where to look next, not to estimate what expanding coverage would change."),
      { type: "table", x: 0, y: 24, w: 12, h: 8, title: "Every mapped value: uninsured count, population and rate by state", dataset: "chTable" },
      note(0, 32, 12, 3, "Source", "Maps show rates, never counts alone; counts are in the table.\nMeasures: County Health Rankings-style factors and outcomes (premature death before age 75, uninsured adults 19–64, health behaviors, social and economic factors) · " + SYNTHETIC)
    ]
  },
  {
    id: "program-outcomes",
    theme: "paper",
    name: "Program outcomes & funder report",
    screenshot: programOutcomesScreenshot,
    description: "Did we reach the people we promised, did they achieve the outcomes we committed to, and what will we change?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Served 101% of the annual goal; 62% achieved their primary outcome", dataset: "poKpis" },
      { type: "column", x: 0, y: 4, w: 12, h: 6, title: "Enrolment reached the 150-per-quarter goal only in 2026 Q3", dataset: "poEnrollments", tileOptions: { sort: "data", referenceValue: 150, referenceLabel: "Goal: 150 per quarter", yLabel: "Participants enrolled" } },
      { type: "smallMultiples", x: 0, y: 10, w: 12, h: 6, title: "Riverbend housing leads; Northfield trails in both of its programmes (% achieving primary outcome; overall 62%)", dataset: "poAttainment", tileOptions: { sort: "desc" } },
      { type: "dot", x: 0, y: 16, w: 6, h: 6, title: "Every cohort improved", dataset: "poPrePost", tileOptions: { sort: "data", xLabel: "Mean change, self-sufficiency matrix (points)" } },
      { type: "stackedBar", x: 6, y: 16, w: 6, h: 7, title: "More Black, fewer White", dataset: "poDemographics", tileOptions: { mode: "grouped", xLabel: "% of participants vs service-area residents" } },
      note(0, 23, 12, 4, "What we learned / what changes", "Learned: enrolment lagged the goal for ten quarters and caught up only when the Eastside referral partnership started. Northfield participants achieve outcomes 7–22 points below other sites. Participants are more Black and less White than the service area, so outreach is reaching the residents most affected.\nChanges: add a second Northfield coach and transportation stipends in 2027 Q1; report Northfield separately to the funder each quarter.\nMeasures: program logic model (outputs → outcomes); self-sufficiency matrix · " + SYNTHETIC)
    ]
  },
  {
    id: "system-flow",
    theme: "paper",
    name: "System flow: inflow, outflow & actively homeless",
    screenshot: systemFlowScreenshot,
    description: "Is homelessness going down month by month, and is it because fewer people are entering or more are leaving?",
    inspiredBy: null,
    tiles: [
      { type: "area", x: 0, y: 0, w: 12, h: 7, title: "Inflow and outflow trade places; the gap between them, not either line, moves the count", dataset: "flowInOut", tileOptions: { yLabel: "People per month" } },
      { type: "line", x: 0, y: 7, w: 7, h: 7, title: "Peak 1,709 (Jan 2025); falling", dataset: "flowActive", tileOptions: { yLabel: "People actively homeless" } },
      { type: "bar", x: 7, y: 7, w: 5, h: 7, title: "Half single", dataset: "flowByGroup", tileOptions: { sort: "data", xLabel: "People homeless, Sep 2026" } },
      { type: "kpi", x: 0, y: 14, w: 12, h: 4, title: "September 2026: outflow ahead of inflow; net change negative over three months", dataset: "flowKpis" },
      note(0, 18, 12, 4, "Events behind the lines", "Jun 2024: encampment resolution moved ~150 people into shelter (inflow spike). Jan 2025: rapid re-housing surge funding began (outflow up). Aug 2025: countywide rent increases (inflow up). Mar 2026: non-congregate motel program closed (outflow down for four months), undoing more than half of the gains since the peak.\nSeptember 2026 is provisional while HMIS records reconcile. “Months to zero” is arithmetic on the last three months' net change, not a forecast.\nMeasures: by-name list monthly inflow, outflow and actively homeless (Built for Zero-style monthly cadence) · " + SYNTHETIC)
    ]
  },
  {
    id: "city-services-311",
    theme: "paper",
    name: "City services: 311 operations",
    screenshot: cityServicesScreenshot,
    description: "Are residents' requests being closed on time, and where is the backlog building?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "65% of requests closed within target, against an 80% goal", dataset: "cs311Kpis" },
      { type: "area", x: 0, y: 4, w: 12, h: 7, title: "Closures trail openings in the last weeks: partly real backlog, partly requests not yet due", dataset: "cs311Daily", tileOptions: { yLabel: "Requests per day" } },
      { type: "bar", x: 0, y: 11, w: 6, h: 7, title: "Top 3 types: 48% of volume", dataset: "cs311Types", tileOptions: { xLabel: "Requests opened (150 days)" } },
      { type: "dot", x: 6, y: 11, w: 6, h: 7, title: "Medians beat every target", dataset: "cs311CloseVsTarget", tileOptions: { sort: "desc", referenceValue: 100, referenceLabel: "Target", xLabel: "Median days to close as % of target" } },
      { type: "heatmap", x: 0, y: 18, w: 7, h: 8, title: "Weekday mornings carry the load", dataset: "cs311Heatmap" },
      { type: "bar", x: 7, y: 18, w: 5, h: 8, title: "D6 slowest", dataset: "cs311District", tileOptions: { xLabel: "Median hours to close" } },
      { type: "table", x: 0, y: 26, w: 12, h: 8, title: "By request type: opened, closed, on-time share and days to close", dataset: "cs311Table" },
      note(0, 34, 12, 3, "Reading the close times", "“Days to close” is administrative: the time until a ticket is marked closed, not until the problem is fixed. Every type's median beats its target, yet only 65% of requests close on time: the long tail is what misses. Recent weeks are censored: requests opened lately that are still open are left out of medians, so the latest close times look faster than they are.\nMeasures: 311 service-request volume and days to close against type-specific targets, Jun 4 – Oct 31, 2026 · " + SYNTHETIC)
    ]
  },
  {
    id: "performance-scorecard",
    theme: "paper",
    name: "Performance scorecard (targets & thresholds)",
    screenshot: performanceScorecardScreenshot,
    description: "Which of our commitments are on target, which are at risk, and what are we doing about the ones that are off?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Five of 12 measures are on target this quarter; three are off", dataset: "scKpis" },
      { type: "table", x: 0, y: 4, w: 12, h: 8, title: "Status thresholds: On target ≥100% of target · At risk 90–99.9% · Off target <90%", dataset: "scTable" },
      { type: "dot", x: 0, y: 12, w: 12, h: 7, title: "Staff vacancies, 311 timeliness and housing exits are furthest from target", dataset: "scPctTarget", tileOptions: { sort: "desc", referenceValue: 100, referenceLabel: "Target (100%)", xLabel: "% of target achieved (lower-is-better measures inverted)" } },
      { type: "smallMultiples", x: 0, y: 19, w: 12, h: 8, title: "Each perspective's average % of target improved for four quarters", dataset: "scPerspectiveTrend", tileOptions: { sort: "data" } },
      note(0, 27, 12, 4, "Actions for off-target measures", "Direct-service vacancy (70% of target): retention stipends approved; recruiting fair Dec 4.\n311 requests closed within target (82% of target): sidewalk and abandoned-vehicle crews added; weekly backlog review with Public Works.\nExits to permanent housing (87% of target): landlord incentive fund relaunches in January; housing navigators reassigned to the longest-stay families.\nStatus colors are not used: every status prints its threshold. Measures are grouped by Balanced Scorecard perspective · " + SYNTHETIC)
    ]
  },
  {
    id: "executive-overview",
    theme: "paper",
    name: "Executive overview",
    screenshot: executiveOverviewScreenshot,
    description: "Is the organization on plan this year, and which function is furthest from budget?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Ahead of last year on revenue; retention and on-time delivery below target", dataset: "exKpis" },
      { type: "line", x: 0, y: 4, w: 7, h: 7, title: "Ahead of 2025 every month", dataset: "exRevenue", tileOptions: { yLabel: "Revenue ($M)" } },
      { type: "bar", x: 7, y: 4, w: 5, h: 7, title: "Tech under", dataset: "exByFunction", tileOptions: { sort: "desc", referenceValue: 100, referenceLabel: "Budget", xLabel: "Actual as % of YTD budget" } },
      { type: "stackedColumn", x: 0, y: 11, w: 12, h: 7, title: "Actual vs budget, year to date, by function ($M): Technology furthest under at 89%", dataset: "exBudget", tileOptions: { mode: "grouped", yLabel: "$M" } },
      note(0, 18, 12, 3, "Source", "One headline per function; every KPI shows its change and its target or comparison. Synthetic data for a fictitious organization.")
    ]
  },
  {
    id: "sales-performance",
    theme: "paper",
    name: "Sales performance",
    screenshot: salesPerformanceScreenshot,
    description: "Will we make the number, and which reps, stages and deals decide it?",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 4, title: "Bookings up on last year; pipeline coverage just above 3×", dataset: "slKpis" },
      { type: "dot", x: 0, y: 4, w: 6, h: 7, title: "3 of 10 reps at quota", dataset: "slQuota", tileOptions: { sort: "desc", referenceValue: 100, referenceLabel: "Quota", xLabel: "% of year-to-date quota" } },
      { type: "column", x: 6, y: 4, w: 6, h: 7, title: "Thins fast after Proposal", dataset: "slPipeline", tileOptions: { sort: "data", yLabel: "Open pipeline ($M)" } },
      { type: "line", x: 0, y: 11, w: 7, h: 7, title: "Beat last year in 10 of 12 months", dataset: "slBookings", tileOptions: { yLabel: "Bookings ($k)" } },
      { type: "scatter", x: 7, y: 11, w: 5, h: 7, title: "Big = slow", dataset: "slDeals", tileOptions: { trend: false, xLabel: "Deal size ($k)", yLabel: "Days to close" } },
      note(0, 18, 12, 3, "Source", "Quota attainment is year to date; coverage is open pipeline over remaining-year quota ($2.9M), against a 3× target. Bigger deals take longer: enterprise cycles run about four months. Synthetic data for a fictitious sales team.")
    ]
  }
];

// ── User templates (saved from the user's own dashboards) ────────────────
const USER_TPL_KEY = "dashbuilder.templates.v1";
const LEGACY_USER_TPL_KEY = "klaroDash.templates.v1"; // pre-theme era; read once, then dropped

/** Drop tiles with unknown types and clamp geometry to sane ranges. */
export function sanitizeTiles(tiles, rowHeight) {
  try {
    return validateLayout({ app: 'dashboard-builder', version: rowHeight ? 3 : 1, rowHeight, tiles }).tiles.map(({ id,...t }) => t);
  } catch { return []; }
}

export function loadUserTemplates() {
  try {
    const raw = localStorage.getItem(USER_TPL_KEY) || localStorage.getItem(LEGACY_USER_TPL_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.id === "string" && typeof t.name === "string")
      .map((t) => ({ ...t, rowHeight: 24, tiles: sanitizeTiles(t.tiles, t.rowHeight) }))
      .filter((t) => t.tiles.length > 0);
  } catch {
    return [];
  }
}

function writeUserTemplates(list) {
  localStorage.setItem(USER_TPL_KEY, JSON.stringify(list));
  try {
    localStorage.removeItem(LEGACY_USER_TPL_KEY);
  } catch {
    /* ignore */
  }
}

export function saveUserTemplate(name, tiles, theme = "paper") {
  const clean = sanitizeTiles(tiles, 24);
  if (!name.trim() || clean.length === 0) return null;
  const list = loadUserTemplates();
  const tpl = {
    id: `user-${Date.now().toString(36)}`,
    name: name.trim().slice(0, 60),
    theme,
    version: 3,
    rowHeight: 24,
    createdAt: new Date().toISOString(),
    inspiredBy: null,
    tiles: clean
  };
  list.push(tpl);
  try {
    writeUserTemplates(list);
  } catch {
    return null;
  }
  return tpl;
}

export function deleteUserTemplate(id) {
  try {
    writeUserTemplates(loadUserTemplates().filter((t) => t.id !== id));
    return true;
  } catch {
    return false;
  }
}
