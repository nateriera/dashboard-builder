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
// measure-source line. Geometry uses 24px grid rows (rowHeight: 24); each
// template fits one 1440×900 present-mode screen (35 rows), no page scroll.

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
// Landscape canvas (PR #42 review, B6): every template fits one 1440×900
// present-mode screen with no page scroll — 35 rows of 24px. KPI strip on
// top, one band of charts side by side, the annotation as a footer strip.
// Tiles carry no per-tile "Source: Sample data" line; the closing
// annotation names the measures and their source.
const tile = (type, x, y, w, h, title, dataset, tileOptions) => ({ type, x, y, w, h, title, source: "", dataset, binding: { mode: "explicit", ref: dataset }, ...(tileOptions ? { tileOptions } : {}) });
const note = (x, y, w, h, title, body) => ({ type: "text", x, y, w, h, title, binding: { mode: "none" }, tileOptions: { body } });

export const BUILT_IN_TEMPLATES = [
  {
    id: "homeless-system-performance",
    theme: "paper",
    rowHeight: 24,
    name: "Homeless system performance (CoC)",
    screenshot: homelessSystemScreenshot,
    description: "Is the homeless response system getting people housed faster, keeping them housed, and doing it equitably?",
    inspiredBy: { name: "HUD System Performance Measures and Stella P (structural pattern only)", url: "https://www.hudexchange.info/programs/coc/system-performance-measures/" },
    tiles: [
      tile("kpi", 0, 0, 12, 12, "FY2026: shorter stays and fewer returns; exits to housing still short of the 45% goal", "cocKpis"),
      tile("bar", 0, 12, 4, 17, "4 in 10 exits went to housing", "cocExitDestinations", { sort: "data", xLabel: "Exits, FY2026" }),
      tile("smallMultiples", 4, 12, 5, 17, "By race: Black households exit to housing least and return most", "cocEquity", { sort: "data" }),
      tile("table", 9, 12, 3, 17, "System Performance Measures, FY2025 vs FY2026", "cocSpmBriefTable"),
      note(0, 29, 12, 6, "What the measures say", "Every household type's median fell from FY2025 to FY2026 (adults only 74 → 63 days, families 190 → 133, youth 18–24 63 → 47, veterans 62 → 49), but families, the longest stayers, grew from 11.5% to 28.9% of stays, so the overall median barely moved (76.5 → 75.5; mean 167). Black households exited to housing at 32.5% vs 47.0% for White households and returned within 24 months at 17.2% vs 10.2%; groups under 20 exits are suppressed. 64 of 121 returns came within 6 months. M6 does not apply (not a Category 3 CoC); 4% of exit destinations are unknown.\nMeasures: HUD System Performance Measures (M1–M5, M7), FY2025 definitions · " + SYNTHETIC)
    ]
  },
  {
    id: "behavioral-health-quality",
    theme: "paper",
    rowHeight: 24,
    name: "Behavioral health quality (CCBHC)",
    screenshot: behavioralHealthScreenshot,
    description: "Are clients getting timely care and getting better, and which sites and measures need attention?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 12, "Remission beats benchmark; 30-day follow-up after hospitalization sits just under it", "bhKpis"),
      tile("dot", 0, 12, 3, 18, "7 of 10 meet benchmark", "bhGapToBenchmark", { sort: "data", referenceValue: 0, referenceLabel: "Benchmark", xLabel: "Points vs benchmark" }),
      tile("line", 3, 12, 3, 18, "DEP-REM-6 rose at Downtown and Riverbend after Jul 2025", "bhSiteTrendLines", { yLabel: "% in remission at 6 months" }),
      tile("stackedBar", 6, 12, 3, 18, "Up to a third never get a 6-month PHQ-9", "bhPhqBands", { mode: "stacked", xLabel: "% of index patients" }),
      tile("table", 9, 12, 3, 18, "Every measure: rate, benchmark and numerator / denominator (last 12 months)", "bhMeasureBriefTable"),
      note(0, 30, 12, 5, "Reading this dashboard", "Northfield, the rural mobile site, is lowest on 9 of 10 measures. Paired 7- and 30-day follow-up measures (FUH, FUM, FUA) sit next to each other. Benchmarks are illustrative, not published national values. Quarterly site lines are noisy: each quarter has 60–170 index patients per site. PHQ bands are shares of patients with an index PHQ-9 above 9, last 12 months.\nMeasures: CCBHC quality measures (I-SERV, DEP-REM-6, FUH, FUM, FUA, SRA) · " + SYNTHETIC)
    ]
  },
  {
    id: "health-center-quality",
    theme: "paper",
    rowHeight: 24,
    name: "Health center quality (UDS)",
    screenshot: healthCenterScreenshot,
    description: "Is the health center reaching the patients it exists for, and are its clinical quality measures improving?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 11, "28,655 patients, nearly nine in ten low-income; blood-pressure control up again", "udsKpis"),
      tile("stackedColumn", 0, 11, 4, 19, "All four headline measures improved every year", "udsCqmTrend", { mode: "grouped", yLabel: "% of eligible patients" }),
      tile("dot", 4, 11, 4, 19, "Beats national on 5 of 10", "udsVsNational", { sort: "desc", referenceValue: 0, referenceLabel: "National", xLabel: "Points better (+) or worse (−) than national" }),
      tile("stackedColumn", 8, 11, 4, 19, "Medicaid and uninsured patients are two-thirds of the panel every year", "udsPayerMix", { mode: "stacked", yLabel: "% of patients" }),
      note(0, 30, 12, 5, "Source", "Diabetes poor control is inverse (lower is better, so falling is improving); its gap is national minus centre, so positive always means better. National comparators are illustrative. 2025 visits: medical 61%, dental 16%, behavioral health 11%, enabling services (case management, outreach) 6%, substance use disorder 3%, vision 2%.\nMeasures: HRSA Uniform Data System clinical quality measures, calendar years 2021–2025 · " + SYNTHETIC)
    ]
  },
  {
    id: "overdose-surveillance",
    theme: "paper",
    rowHeight: 24,
    name: "Overdose & SUD community surveillance",
    screenshot: overdoseScreenshot,
    description: "Are overdose deaths falling, what is driving them, and is the response reaching people?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 13, "Deaths and nonfatal ED visits are both down from a year ago", "odKpis"),
      tile("line", 0, 13, 3, 17, "Down from the 56.2 peak after naloxone", "odRollingRate", { yLabel: "Deaths per 100k, rolling 12 mo" }),
      tile("line", 3, 13, 3, 17, "Fentanyl drives the rise; xylazine appears from 2023", "odBySubstanceTrend", { yLabel: "Deaths per 100k (not additive)" }),
      tile("choropleth", 6, 13, 3, 17, "State rates vary 6.6× (synthetic)", "odStateRates"),
      tile("dot", 9, 13, 3, 17, "Ten highest state rates", "odStateRates", { sort: "desc", topN: 10, xLabel: "Deaths per 100k" }),
      note(0, 30, 12, 5, "Provisional data and small numbers", "Fentanyl became dominant in Apr 2020, xylazine appeared in Mar 2023, and leave-behind naloxone launched in Jul 2024. Nonfatal ED visits (1,207 in 12 months, down 19.5%) lead deaths by about two months. The latest six months are provisional and will rise; monthly counts are small (3–25), so rates are rolling 12-month sums. One death can involve several substances.\nMeasures: overdose deaths per 100,000 residents, nonfatal overdose ED visits, EMS naloxone administrations · " + SYNTHETIC)
    ]
  },
  {
    id: "community-health-by-place",
    theme: "paper",
    rowHeight: 24,
    name: "Community health by place",
    screenshot: communityHealthScreenshot,
    description: "How does Meridian compare with its state and the nation, and where are the gaps largest?",
    inspiredBy: { name: "County Health Rankings & Roadmaps model (structural pattern only)", url: "https://www.countyhealthrankings.org/" },
    tiles: [
      tile("kpi", 0, 0, 12, 12, "Meridian's premature death rate is 11% above the state and 14% above the U.S.", "chKpis"),
      tile("choropleth", 0, 12, 3, 18, "Uninsured: 3.6% to 23.8% by state", "chStateRates"),
      tile("dot", 3, 12, 3, 18, "Ten highest uninsured rates", "chStateRates", { sort: "desc", topN: 10, xLabel: "% uninsured, adults 19–64" }),
      tile("scatter", 6, 12, 3, 18, "More uninsured, more early deaths", "chScatter", { xLabel: "Uninsured adults 19–64 (%)", yLabel: "Premature deaths per 100k" }),
      tile("stackedBar", 9, 12, 3, 18, "Meridian runs above the state and U.S. on all six factors", "chFactorsCompared", { mode: "grouped", xLabel: "% of residents" }),
      note(0, 30, 12, 5, "Source", "Across states r = 0.81: association, not effect (coverage, income, rurality and age structure move together). Maps show rates, never counts alone; each state's uninsured count and adult population are in the map's and the ranking's data. Factor names are shortened in the chart; full definitions are in its data.\nMeasures: County Health Rankings-style factors and outcomes (premature death before 75, uninsured adults 19–64) · " + SYNTHETIC)
    ]
  },
  {
    id: "program-outcomes",
    theme: "paper",
    rowHeight: 24,
    name: "Program outcomes & funder report",
    screenshot: programOutcomesScreenshot,
    description: "Did we reach the people we promised, did they achieve the outcomes we committed to, and what will we change?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 11, "Served 101% of the annual goal; 62% achieved their primary outcome", "poKpis"),
      tile("smallMultiples", 0, 11, 7, 18, "Riverbend housing leads; Northfield trails in both of its programmes (% achieving primary outcome; overall 62%)", "poAttainment", { sort: "desc" }),
      tile("stackedBar", 7, 11, 5, 18, "More Black and fewer White participants than the service area", "poDemographics", { mode: "grouped", xLabel: "% of participants vs service-area residents" }),
      note(0, 29, 12, 6, "What we learned / what changes", "Learned: enrolment lagged the 150-per-quarter goal for ten quarters (108 in 2024 Q1, 149 in 2026 Q2) and passed it only in 2026 Q3 (169), after the Eastside referral partnership started. Northfield participants achieve outcomes 7–22 points below other sites. Every cohort improved on the self-sufficiency matrix (mean change +1.0 to +1.6 points, n = 41–61). Changes: a second Northfield coach and transportation stipends in 2027 Q1; Northfield reported to the funder separately each quarter.\nMeasures: program logic model (outputs → outcomes); self-sufficiency matrix · " + SYNTHETIC)
    ]
  },
  {
    id: "system-flow",
    theme: "paper",
    rowHeight: 24,
    name: "System flow: inflow, outflow & actively homeless",
    screenshot: systemFlowScreenshot,
    description: "Is homelessness going down month by month, and is it because fewer people are entering or more are leaving?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 11, "September 2026: outflow ahead of inflow; net change negative over three months", "flowKpis"),
      tile("area", 0, 11, 5, 19, "Inflow and outflow trade places; the gap between them moves the count", "flowInOut", { yLabel: "People per month" }),
      tile("line", 5, 11, 4, 19, "Peak 1,709 (Jan 2025); falling", "flowActive", { yLabel: "People actively homeless" }),
      tile("bar", 9, 11, 3, 19, "Single adults are half", "flowByGroup", { sort: "data", xLabel: "People homeless, Sep 2026" }),
      note(0, 30, 12, 5, "Events behind the lines", "Jun 2024: encampment resolution moved ~150 people into shelter (inflow spike). Jan 2025: rapid re-housing surge funding began (outflow up). Aug 2025: countywide rent increases (inflow up). Mar 2026: the non-congregate motel program closed (outflow down for four months), undoing over half the gains since the peak. September 2026 is provisional; “months to zero” is arithmetic, not a forecast.\nMeasures: by-name list monthly inflow, outflow and actively homeless (Built for Zero-style monthly cadence) · " + SYNTHETIC)
    ]
  },
  {
    id: "city-services-311",
    theme: "paper",
    rowHeight: 24,
    name: "City services: 311 operations",
    screenshot: cityServicesScreenshot,
    description: "Are residents' requests being closed on time, and where is the backlog building?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 12, "65% of requests closed within target, against an 80% goal", "cs311Kpis"),
      tile("area", 0, 12, 3, 18, "Closures trail openings in the last weeks", "cs311Daily", { yLabel: "Requests per day" }),
      tile("dot", 3, 12, 3, 18, "Medians beat every target", "cs311CloseVsTarget", { sort: "desc", referenceValue: 100, referenceLabel: "Target", xLabel: "Median days to close, % of target" }),
      tile("bar", 6, 12, 3, 18, "District 6 is slowest", "cs311District", { xLabel: "Median hours to close" }),
      tile("table", 9, 12, 3, 18, "By request type: opened, on-time share and median days to close", "cs311BriefTable"),
      note(0, 30, 12, 5, "Reading the close times", "“Days to close” is administrative: the time until a ticket is marked closed, not until the problem is fixed. Every type's median beats its target, yet only 65% of requests close on time: the long tail is what misses. Recent weeks are censored, so the latest close times look faster than they are. Trash pickup, potholes and streetlights are 48% of volume, and weekday mornings (6am–noon) carry the load.\nMeasures: 311 service-request volume and days to close against type-specific targets, Jun 4 – Oct 31, 2026 · " + SYNTHETIC)
    ]
  },
  {
    id: "performance-scorecard",
    theme: "paper",
    rowHeight: 24,
    name: "Performance scorecard (targets & thresholds)",
    screenshot: performanceScorecardScreenshot,
    description: "Which of our commitments are on target, which are at risk, and what are we doing about the ones that are off?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 10, "Five of 12 measures are on target this quarter; three are off", "scKpis"),
      tile("table", 0, 10, 9, 19, "Status thresholds: On target ≥100% of target · At risk 90–99.9% · Off target <90%", "scTable"),
      tile("line", 9, 10, 3, 19, "Every perspective improved for four quarters", "scPerspectiveTrendLines", { yLabel: "Average % of target" }),
      note(0, 29, 12, 6, "Actions for off-target measures", "Direct-service vacancy (70% of target): retention stipends approved; recruiting fair Dec 4.\n311 requests closed within target (82% of target): sidewalk and abandoned-vehicle crews added; weekly backlog review with Public Works.\nExits to permanent housing (87% of target): landlord incentive fund relaunches in January; housing navigators reassigned to the longest-stay families.\nStatus colors are not used: every status prints its threshold. Measures are grouped by Balanced Scorecard perspective · " + SYNTHETIC)
    ]
  },
  {
    id: "executive-overview",
    theme: "paper",
    rowHeight: 24,
    name: "Executive overview",
    screenshot: executiveOverviewScreenshot,
    description: "Is the organization on plan this year, and which function is furthest from budget?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 12, "Ahead of last year on revenue; retention and on-time delivery below target", "exKpis"),
      tile("line", 0, 12, 4, 19, "Ahead of 2025 every month", "exRevenue", { yLabel: "Revenue ($M)" }),
      tile("bar", 4, 12, 4, 19, "Tech under", "exByFunction", { sort: "desc", referenceValue: 100, referenceLabel: "Budget", xLabel: "Actual as % of YTD budget" }),
      tile("stackedBar", 8, 12, 4, 19, "Actual vs budget, year to date ($M): Technology furthest under at 89%", "exBudget", { mode: "grouped", xLabel: "$M, year to date" }),
      note(0, 31, 12, 4, "Source", "One headline per function; every KPI shows its change and its target or comparison. Synthetic data for a fictitious organization.")
    ]
  },
  {
    id: "sales-performance",
    theme: "paper",
    rowHeight: 24,
    name: "Sales performance",
    screenshot: salesPerformanceScreenshot,
    description: "Will we make the number, and which reps, stages and deals decide it?",
    inspiredBy: null,
    tiles: [
      tile("kpi", 0, 0, 12, 11, "Bookings up on last year; pipeline coverage just above 3×", "slKpis"),
      tile("dot", 0, 11, 3, 20, "3 of 10 reps at quota", "slQuota", { sort: "desc", referenceValue: 100, referenceLabel: "Quota", xLabel: "% of year-to-date quota" }),
      tile("line", 3, 11, 3, 20, "Beat last year in 10 of 12 months", "slBookings", { yLabel: "Bookings ($k)" }),
      tile("column", 6, 11, 3, 20, "Thins fast after Proposal", "slPipeline", { sort: "data", yLabel: "Open pipeline ($M)" }),
      tile("scatter", 9, 11, 3, 20, "Big = slow", "slDeals", { trend: false, xLabel: "Deal size ($k)", yLabel: "Days to close" }),
      note(0, 31, 12, 4, "Source", "Quota attainment is year to date; coverage is open pipeline over remaining-year quota ($2.9M), against a 3× target. Bigger deals take longer: enterprise cycles run about four months. Synthetic data for a fictitious sales team.")
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
