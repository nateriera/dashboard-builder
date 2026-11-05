#!/usr/bin/env node
// Meridian County sample-data generator.
//
// Meridian County is a FICTITIOUS jurisdiction. Every number this script
// writes is synthetic: generated from a seeded PRNG, never hand-typed and
// never copied from a real CoC, clinic, health center, city or state.
// Published work contributed measure *definitions* only (HUD System
// Performance Measures, CCBHC quality measures, HRSA UDS clinical quality
// measures, County Health Rankings-style factor/outcome framing).
//
// One county, five systems that reconcile where they overlap: the CoC's
// homeless response system, a CCBHC behavioral-health clinic, an FQHC health
// center, the county 311 system and the county health profile — plus two
// general families (executive, sales) for the general-audience templates.
//
// Usage:
//   node scripts/generate-sample-data.mjs            # writes src/data/meridian/*.json (+ labels.json)
//   node scripts/generate-sample-data.mjs --check    # regenerate in memory, verify
//                                                    # plausibility anchors + that the
//                                                    # committed files are byte-identical
//   node scripts/generate-sample-data.mjs --out DIR  # write somewhere else
//
// Determinism: same SEED -> byte-identical output. No Date.now(), no locale
// formatting, no Math.random(); every draw comes from one mulberry32 stream
// per family (so editing one family never shifts another family's numbers).
//
// Temporal model per series: base + trend + weekly shape + annual
// seasonality + noise + planted events. Planted events are named constants
// (EVENTS below) so template annotations can cite them.
//
// Realism planted on purpose: unknown/missing categories kept visible (HMIS
// "client doesn't know" and "data not collected" exit destinations, income
// unknown, no 6-month PHQ-9), parts that sum through an explicit unknown/other
// row, site-to-site outcome spread, right-skewed durations (mean > median),
// small monthly county counts, a provisional tail, and one mix-shift in the
// CoC data (every household type improves while the overall median does not,
// because families — the longest stayers — become a bigger share).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEED = 20261104;
export const AS_OF = "2026-10-31"; // data through this date; FY2026 = Oct 2025 – Sep 2026

export const EVENTS = {
  // CoC / system flow
  ENCAMPMENT_RESOLUTION: { month: "2024-06", note: "Riverside encampment resolution moved ~150 people into shelter over three months (inflow spike)." },
  RRH_SURGE: { month: "2025-01", note: "One-time rapid re-housing surge funding began; outflow to housing rose and stayed higher." },
  RENT_SHOCK: { month: "2025-08", note: "Countywide rent increases after a large lease-up cycle; inflow stepped up." },
  MOTEL_PROGRAM_CLOSURE: { month: "2026-03", note: "Non-congregate motel program closed; outflow dipped for four months." },
  // Overdose
  FENTANYL_EMERGENCE: { month: "2020-04", note: "Illicit fentanyl became the dominant opioid in the local supply." },
  XYLAZINE_DETECTED: { month: "2023-03", note: "First xylazine detections in toxicology; involvement rose through 2024." },
  NALOXONE_PROGRAMME: { month: "2024-07", note: "Leave-behind naloxone and post-overdose outreach programme launched." },
  // 311
  JULY_STORM: { date: "2026-07-14", note: "Severe storm: tree/limb and water-main requests spiked for ~10 days." },
  // Behavioral health
  MEASUREMENT_BASED_CARE: { month: "2025-07", note: "Measurement-based care rollout at two sites lifted PHQ-9 reassessment and remission." }
};

// ── PRNG + draws ──────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function stream(name) {
  const rand = mulberry32((SEED ^ hashString(name)) >>> 0);
  const normal = (m = 0, s = 1) => { let u = 0; while (u === 0) u = rand(); const v = rand(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const poisson = (lambda) => {
    if (lambda <= 0) return 0;
    if (lambda > 40) return Math.max(0, Math.round(normal(lambda, Math.sqrt(lambda))));
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  };
  const binom = (n, p) => {
    p = clamp(p, 0, 1);
    if (n < 60) { let k = 0; for (let i = 0; i < n; i++) if (rand() < p) k++; return k; }
    return Math.round(clamp(normal(n * p, Math.sqrt(n * p * (1 - p))), 0, n));
  };
  const lognormal = (median, sigma) => median * Math.exp(normal(0, sigma));
  const pick = (weights) => { const total = weights.reduce((s, w) => s + w, 0); let r = rand() * total; for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; } return weights.length - 1; };
  return { rand, normal, poisson, binom, lognormal, pick };
}

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (num, den) => (den ? r1((100 * num) / den) : null);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
function commas(n) { const s = String(Math.round(Math.abs(n))); const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); return (n < 0 ? "-" : "") + out; }
function signed(x, digits = 1, unit = "") { const v = digits === 0 ? Math.round(x) : Number(x.toFixed(digits)); const s = v > 0 ? "▲" : v < 0 ? "▼" : "■"; const u = Math.abs(v) === 1 && unit === " days" ? " day" : unit; return `${s} ${Math.abs(v).toFixed(digits)}${u}`; }
function months(start, n) { let [y, m] = start.split("-").map(Number); const out = []; for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; }
function monthIndex(ym) { const [y, m] = ym.split("-").map(Number); return y * 12 + (m - 1); }
function monthName(ym) { return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(ym.slice(5, 7)) - 1]; }
// Day arithmetic on UTC epoch days (no local time zones anywhere).
const DAY = 86400000;
function dayNum(iso) { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY; }
function isoDay(n) { const d = new Date(n * DAY); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function weekday(n) { return (new Date(n * DAY).getUTCDay() + 6) % 7; } // 0 = Monday
const quarterOf = (ym) => `${ym.slice(0, 4)} Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;
const fyOf = (ym) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return `FY${m >= 10 ? y + 1 : y}`; };

// Seasonal + trend + noise + events, one value per step.
function series(s, n, { base, trend = 0, seasonAmp = 0, seasonPeak = 0, period = 12, noise = 0, events = [] }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let v = base + trend * i + seasonAmp * Math.cos((2 * Math.PI * (i - seasonPeak)) / period) + s.normal(0, noise);
    for (const e of events) if (i >= e.at) v += e.effect(i - e.at);
    out.push(v);
  }
  return out;
}

// ── shared geography ──────────────────────────────────────────────────────
const STATES = [
  ["01", "Alabama"], ["02", "Alaska"], ["04", "Arizona"], ["05", "Arkansas"], ["06", "California"], ["08", "Colorado"], ["09", "Connecticut"], ["10", "Delaware"], ["11", "D.C."], ["12", "Florida"], ["13", "Georgia"], ["15", "Hawaii"], ["16", "Idaho"], ["17", "Illinois"], ["18", "Indiana"], ["19", "Iowa"], ["20", "Kansas"], ["21", "Kentucky"], ["22", "Louisiana"], ["23", "Maine"], ["24", "Maryland"], ["25", "Massachusetts"], ["26", "Michigan"], ["27", "Minnesota"], ["28", "Mississippi"], ["29", "Missouri"], ["30", "Montana"], ["31", "Nebraska"], ["32", "Nevada"], ["33", "New Hampshire"], ["34", "New Jersey"], ["35", "New Mexico"], ["36", "New York"], ["37", "North Carolina"], ["38", "North Dakota"], ["39", "Ohio"], ["40", "Oklahoma"], ["41", "Oregon"], ["42", "Pennsylvania"], ["44", "Rhode Island"], ["45", "South Carolina"], ["46", "South Dakota"], ["47", "Tennessee"], ["48", "Texas"], ["49", "Utah"], ["50", "Vermont"], ["51", "Virginia"], ["53", "Washington"], ["54", "West Virginia"], ["55", "Wisconsin"], ["56", "Wyoming"]
];
// Synthetic state populations (millions-scale shape only, not census values).
function statePopulations(s) { return STATES.map(([id], i) => Math.round(clamp(s.lognormal(4.2e6, 0.95), 5.8e5, 3.9e7) / 1000) * 1000); }
// Spread a set of state rates log-uniformly between lo and hi (hi/lo = spread).
function spreadRates(s, lo, hi) {
  const n = STATES.length; const order = STATES.map((_, i) => i).sort(() => 0); // fixed order
  const ranks = order.map(() => s.rand()).map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i], r) => [i, r]);
  const rates = new Array(n);
  for (const [i, r] of ranks) rates[i] = lo * Math.pow(hi / lo, r / (n - 1)) * Math.exp(s.normal(0, 0.02));
  return rates;
}

export const COUNTY_POP = 412_600;

// ═════════════════════════════════════════════════════════════════════════
// 1. CoC — HUD System Performance Measures + monthly flow
// ═════════════════════════════════════════════════════════════════════════
function buildCoc() {
  const s = stream("coc");
  const FLOW_MONTHS = months("2023-10", 36); // FY2024–FY2026
  const at = (ym) => FLOW_MONTHS.indexOf(ym);
  const inflow = series(s, 36, {
    base: 212, trend: 0.35, seasonAmp: 14, seasonPeak: 3, noise: 9,
    events: [
      { at: at(EVENTS.ENCAMPMENT_RESOLUTION.month), effect: (k) => (k < 3 ? [62, 54, 34][k] : 0) },
      { at: at(EVENTS.RENT_SHOCK.month), effect: () => 16 }
    ]
  }).map(Math.round);
  const outflow = series(s, 36, {
    base: 206, trend: 0.25, seasonAmp: 6, seasonPeak: 8, noise: 8,
    events: [
      { at: at(EVENTS.RRH_SURGE.month), effect: (k) => Math.min(27, 9 * (k + 1)) },
      { at: at(EVENTS.MOTEL_PROGRAM_CLOSURE.month), effect: (k) => (k < 4 ? -[24, 21, 15, 8][k] : 0) }
    ]
  }).map(Math.round);
  const active = []; let a = 1418;
  for (let i = 0; i < 36; i++) { a += inflow[i] - outflow[i]; active.push(a); }
  const PROVISIONAL_FROM = "2026-09"; // last month still being reconciled in HMIS

  const flowInOut = FLOW_MONTHS.flatMap((ym, i) => [
    { date: ym, value: inflow[i], series: "Inflow (newly identified + returned)" },
    { date: ym, value: outflow[i], series: "Outflow (housed + inactive)" }
  ]);
  // Line with a distinguishable provisional tail: the boundary month appears
  // in both series so the two segments join.
  const pIdx = at(PROVISIONAL_FROM);
  const flowActive = [];
  FLOW_MONTHS.forEach((ym, i) => {
    if (i <= pIdx - 1) flowActive.push({ date: ym, value: active[i], series: "Actively homeless (reconciled)" });
    if (i >= pIdx - 1) flowActive.push({ date: ym, value: active[i], series: "Provisional (HMIS still reconciling)" });
  });

  // Active by household group (mutually exclusive; explicit unknown row).
  const latest = active.at(-1);
  const groupShares = [["Single adults", "Single adults (non-veteran)", 0.512], ["Families", "People in families with children", 0.248], ["Youth 18–24", "Unaccompanied youth 18–24", 0.112], ["Veterans", "Veterans", 0.094]];
  const flowByGroup = groupShares.map(([label, group, sh]) => ({ label, value: Math.round(latest * sh * (1 + s.normal(0, 0.02))), group }));
  flowByGroup.push({ label: "Not recorded", value: latest - sum(flowByGroup.map((r) => r.value)), group: "Household type not recorded" });

  // FY aggregates from the flow
  const fyMonths = (fy) => FLOW_MONTHS.filter((ym) => fyOf(ym) === fy);
  const fySum = (arr, fy) => sum(fyMonths(fy).map((ym) => arr[at(ym)]));
  const served = (fy) => active[at(fyMonths(fy)[0]) - 1 >= 0 ? at(fyMonths(fy)[0]) - 1 : 0] + fySum(inflow, fy);
  const servedFY26 = active[at("2025-09")] + fySum(inflow, "FY2026");
  const servedFY25 = active[at("2024-09")] + fySum(inflow, "FY2025");
  const exitsFY26 = fySum(outflow, "FY2026");
  const exitsFY25 = fySum(outflow, "FY2025");

  // Person-stays for length of time homeless (M1): lognormal by household
  // type. FY2025 sample too, so FY-over-FY medians come from data.
  const HH = [
    { label: "Adults only", median: 68, share25: 0.66, share26: 0.53 },
    { label: "Families", median: 150, share25: 0.13, share26: 0.28 },
    { label: "Youth 18–24", median: 60, share25: 0.12, share26: 0.12 },
    { label: "Veterans", median: 50, share25: 0.09, share26: 0.07 }
  ];
  const SIGMA = 1.32;
  function stays(n, fy) {
    const improve = fy === "FY2026" ? 1 : 1.03; // each type was slower last FY (plus sampling noise)
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = HH[s.pick(HH.map((x) => (fy === "FY2026" ? x.share26 : x.share25)))];
      const days = Math.round(clamp(s.lognormal(h.median * improve, SIGMA), 1, 1460));
      out.push({ label: h.label, value: days });
    }
    return out;
  }
  const staysFY26 = stays(640, "FY2026");
  const staysFY25 = stays(610, "FY2025");
  const cocLothStays = staysFY26.map((r, i) => ({ label: r.label, value: r.value, stay: `S${String(i + 1).padStart(4, "0")}` }));

  // Days homeless trend by household type, FY2022–FY2026, shared scale.
  // FY2026 = the sample's medians; earlier years back-cast with improvement.
  const FYS = ["FY2022", "FY2023", "FY2024", "FY2025", "FY2026"];
  const typeMedian = (rows, label) => median(rows.filter((r) => r.label === label).map((r) => r.value));
  const cocDaysByHousehold = [];
  for (const h of HH) {
    const m26 = typeMedian(staysFY26, h.label), m25 = typeMedian(staysFY25, h.label);
    const back = [m25 * 1.16, m25 * 1.09, m25 * 1.04];
    const vals = [...back.map((v) => Math.round(v * (1 + s.normal(0, 0.015)))), Math.round(m25), Math.round(m26)];
    FYS.forEach((fy, i) => cocDaysByHousehold.push({ facet: h.label, label: `FY${fy.slice(-2)}`, value: vals[i] }));
  }

  // Exits by race/ethnicity + destination. Group rates set the equity gap;
  // overall rates are the SUM of group numerators over group denominators.
  const RACE = [
    { label: "Black, African American, or African", short: "Black", share: 0.41, pPH: 0.335, pRet: 0.128 },
    { label: "White", short: "White", share: 0.33, pPH: 0.468, pRet: 0.079 },
    { label: "Hispanic/Latina/e/o", short: "Hispanic", share: 0.14, pPH: 0.43, pRet: 0.091 },
    { label: "Multiracial", short: "Multiracial", share: 0.06, pPH: 0.39, pRet: 0.104 },
    { label: "American Indian, Alaska Native, or Indigenous", short: "AI/AN", share: 0.035, pPH: 0.36, pRet: 0.12 },
    { label: "Asian or Asian American", short: "Asian", share: 0.015, pPH: 0.45, pRet: 0.07 },
    { label: "Native Hawaiian or Pacific Islander", short: "NHPI", share: 0.004, pPH: 0.4, pRet: 0.1 },
    { label: "Race/ethnicity not recorded", short: "Not recorded", share: 0.006, pPH: 0.3, pRet: 0.1 }
  ];
  function splitByRace(total) {
    const counts = RACE.map((r) => Math.round(total * r.share));
    counts[1] += total - sum(counts);
    return counts;
  }
  const exitsByRace26 = splitByRace(exitsFY26), exitsByRace25 = splitByRace(exitsFY25);
  const phByRace26 = RACE.map((r, i) => s.binom(exitsByRace26[i], r.pPH));
  const phByRace25 = RACE.map((r, i) => s.binom(exitsByRace25[i], r.pPH - 0.022));
  const ph26 = sum(phByRace26), ph25 = sum(phByRace25);

  // Returns cohort: people who exited to PH two years before the report
  // period, followed 24 months (SPM M2 lookback windows).
  const cohort26 = 892, cohort25 = 846;
  const cohortByRace26 = splitByRace(cohort26);
  const RET_SPLIT = [0.54, 0.24, 0.22]; // <6, 6–12, 13–24 months
  const retByRace26 = RACE.map((r, i) => s.binom(cohortByRace26[i], r.pRet * 1.36)); // 24-month returns
  const ret24 = sum(retByRace26);
  const ret6 = Math.round(ret24 * RET_SPLIT[0] + s.normal(0, 2)), ret12 = Math.round(ret24 * RET_SPLIT[1] + s.normal(0, 2));
  const ret24only = ret24 - ret6 - ret12;
  const ret12FY25 = s.binom(cohort25, 0.109);
  const cocReturnsTiming = [
    { label: "Within 6 months", value: pct(ret6, cohort26), returns: ret6, cohort: cohort26 },
    { label: "6–12 months", value: pct(ret12, cohort26), returns: ret12, cohort: cohort26 },
    { label: "13–24 months", value: pct(ret24only, cohort26), returns: ret24only, cohort: cohort26 }
  ];
  const retWithin12 = ret6 + ret12;

  // Exit destinations (FY2026). PH categories sum to the PH numerator; the
  // rest sum to the non-PH exits; unknowns stay visible.
  const nonPH = exitsFY26 - ph26;
  // [short label for the chart, HMIS destination wording, share]
  const phSplit = [["PH, subsidized", "Permanent: rental with ongoing subsidy", 0.47], ["PH, unsubsidized", "Permanent: rental, no ongoing subsidy", 0.31], ["PH, with family", "Permanent: living with family or friends (permanent tenure)", 0.22]];
  const otherSplit = [["Temp, with family", "Temporary: staying with family or friends", 0.36], ["Shelter or street", "Emergency shelter or place not meant for habitation", 0.31], ["Institutional", "Institutional (hospital, jail, treatment)", 0.15], ["Motel, no voucher", "Other temporary (motel/hotel without voucher)", 0.098], ["Deceased", "Deceased", 0.012], ["DK / refused", "Client doesn't know / prefers not to answer", 0.025], ["Not collected", "Data not collected", 0.045]];
  const alloc = (total, split) => { const rows = split.map(([label, destination, sh]) => ({ label, value: Math.round(total * sh), destination })); rows[0].value += total - sum(rows.map((r) => r.value)); return rows; };
  const cocExitDestinations = [...alloc(ph26, phSplit), ...alloc(nonPH, otherSplit)];

  // Equity small multiples: outcomes facets, race groups as categories.
  // Groups with fewer than 20 exits are suppressed (named in the annotation).
  const cocEquity = [];
  RACE.forEach((r, i) => {
    if (r.label === "Race/ethnicity not recorded") return;
    if (exitsByRace26[i] < 20 || cohortByRace26[i] < 20) return;
    cocEquity.push({ facet: "Exits to permanent housing (%)", label: r.short, group: r.label, value: pct(phByRace26[i], exitsByRace26[i]), n: exitsByRace26[i] });
  });
  RACE.forEach((r, i) => {
    if (r.label === "Race/ethnicity not recorded") return;
    if (exitsByRace26[i] < 20 || cohortByRace26[i] < 20) return;
    cocEquity.push({ facet: "Returned within 24 months (%)", label: r.short, group: r.label, value: pct(retByRace26[i], cohortByRace26[i]), n: cohortByRace26[i] });
  });
  const suppressed = RACE.filter((r, i) => r.label !== "Race/ethnicity not recorded" && (exitsByRace26[i] < 20 || cohortByRace26[i] < 20)).map((r) => r.label);

  const med26 = median(staysFY26.map((r) => r.value)), med25 = median(staysFY25.map((r) => r.value));
  const mean26 = Math.round(mean(staysFY26.map((r) => r.value))), mean25 = Math.round(mean(staysFY25.map((r) => r.value)));
  const phPct26 = pct(ph26, exitsFY26), phPct25 = pct(ph25, exitsFY25);
  const ret12Pct26 = pct(retWithin12, cohort26), ret12Pct25 = pct(ret12FY25, cohort25);
  const firstTime26 = Math.round(fySum(inflow, "FY2026") * 0.71), firstTime25 = Math.round(fySum(inflow, "FY2025") * 0.73);
  const incomeGain26 = 31.4 + r1(s.normal(0, 0.6)), incomeGain25 = 28.9 + r1(s.normal(0, 0.6));
  const pshRetention26 = 93.1 + r1(s.normal(0, 0.4)), pshRetention25 = 92.4 + r1(s.normal(0, 0.4));
  const pit26 = Math.round(active[at("2026-01")] * 0.91), pit25 = Math.round(active[at("2025-01")] * 0.91);

  const cocKpis = [
    { label: "People served, FY2026", value: commas(servedFY26), delta: `${signed(100 * (servedFY26 / servedFY25 - 1), 1, "%")} vs FY2025 (neutral: reflects reach and need)` },
    { label: "Median days homeless (M1)", value: `${med26} days`, delta: `${signed(med26 - med25, 0, " days")} vs FY2025 · mean ${mean26} days · lower is better`, deltaDir: med26 > med25 ? "up" : "down", invert: true },
    { label: "Mean days homeless (M1)", value: `${mean26} days`, delta: `${signed(mean26 - mean25, 0, " days")} vs FY2025 · right-skewed: long stays pull the mean`, deltaDir: mean26 > mean25 ? "up" : "down", invert: true },
    { label: "Exits to permanent housing (M7b.1)", value: `${phPct26}%`, delta: `${signed(phPct26 - phPct25, 1, " pts")} vs FY2025 · CoC goal 45% · ${commas(ph26)} of ${commas(exitsFY26)} exits`, deltaDir: phPct26 >= phPct25 ? "up" : "down" },
    { label: "Returns within 12 months (M2)", value: `${ret12Pct26}%`, delta: `${signed(ret12Pct26 - ret12Pct25, 1, " pts")} vs FY2025 · goal ≤10% · ${retWithin12} of ${cohort26} · lower is better`, deltaDir: ret12Pct26 > ret12Pct25 ? "up" : "down", invert: true }
  ];

  const row = (measure, definition, fy25, fy26, unit, betterWhen) => {
    const change = r1(fy26 - fy25);
    const better = betterWhen === "lower" ? change < 0 : betterWhen === "higher" ? change > 0 : null;
    return { measure, definition, "FY2025": r1(fy25), "FY2026": r1(fy26), change, unit, "better when": betterWhen, direction: better == null ? "context only" : better ? "improved" : "worsened" };
  };
  const cocSpmTable = [
    row("M1a median", "Median days homeless in ES, SH, TH (person-stays)", med25, med26, "days", "lower"),
    row("M1a mean", "Mean days homeless in ES, SH, TH (person-stays)", mean25, mean26, "days", "lower"),
    row("M2 (12 mo)", "% of PH exits two years prior who returned within 12 months", ret12Pct25, ret12Pct26, "%", "lower"),
    row("M3.1", "Point-in-time count, sheltered + unsheltered (January)", pit25, pit26, "people", "lower"),
    row("M3.2", "Annual count of people in ES, SH, TH", servedFY25, servedFY26, "people", "lower"),
    row("M4", "% of CoC-funded adult stayers/leavers who increased total income", incomeGain25, incomeGain26, "%", "higher"),
    row("M5", "People homeless for the first time (no HMIS record in prior 24 months)", firstTime25, firstTime26, "people", "lower"),
    row("M7b.1", "% of exits from ES, SH, TH, RRH to permanent housing", phPct25, phPct26, "%", "higher"),
    row("M7b.2", "% of PSH/OPH participants retained or exited to PH", pshRetention25, pshRetention26, "%", "higher")
  ];

  const famShare25 = pct(staysFY25.filter((r) => r.label === "Families").length, staysFY25.length);
  const famShare26 = pct(staysFY26.filter((r) => r.label === "Families").length, staysFY26.length);

  const cocMonthlyFlow = FLOW_MONTHS.map((ym, i) => ({ month: ym, fy: fyOf(ym), inflow: inflow[i], outflow: outflow[i], net: inflow[i] - outflow[i], active: active[i], provisional: ym >= PROVISIONAL_FROM }));

  const last3net = mean([inflow.at(-1) - outflow.at(-1), inflow.at(-2) - outflow.at(-2), inflow.at(-3) - outflow.at(-3)]);
  const flowKpis = [
    { label: "Inflow, Sep 2026", value: commas(inflow.at(-1)), delta: `${signed(inflow.at(-1) - inflow.at(-13), 0)} vs Sep 2025 · lower is better`, deltaDir: inflow.at(-1) > inflow.at(-13) ? "up" : "down", invert: true },
    { label: "Outflow, Sep 2026", value: commas(outflow.at(-1)), delta: `${signed(outflow.at(-1) - outflow.at(-13), 0)} vs Sep 2025 · higher is better`, deltaDir: outflow.at(-1) >= outflow.at(-13) ? "up" : "down" },
    { label: "Net change, last 3 months (avg/month)", value: `${last3net > 0 ? "+" : ""}${r1(last3net)}`, delta: `actively homeless now ${commas(latest)} · negative is progress`, deltaDir: last3net > 0 ? "up" : "down", invert: true },
    { label: "Months to zero at current net rate", value: last3net < 0 ? `${Math.round(latest / -last3net)} months` : "Not reducing", delta: "arithmetic on the last 3 months, not a forecast" }
  ];

  return {
    datasets: { cocKpis, cocDaysByHousehold, cocExitDestinations, cocLothStays, cocReturnsTiming, cocSpmTable, cocSpmBriefTable: cocSpmTable.map((r) => ({ measure: `${r.measure}, ${r.unit}`, FY2025: r.FY2025, FY2026: r.FY2026, direction: r.direction })), cocEquity, flowInOut, flowActive, flowByGroup, flowKpis, cocMonthlyFlow },
    facts: { unknownExitPct: pct(sum(cocExitDestinations.filter((r) => /doesn't know|not collected/i.test(r.destination)).map((r) => r.value)), exitsFY26), servedFY26, servedFY25, exitsFY26, ph26, phPct26, phPct25, med26, med25, mean26, mean25, ret6, ret12, ret24, cohort26, ret12Pct26, ret12Pct25, retWithin12, famShare25, famShare26, suppressed, latest, last3net, pit26, activeSeries: active, months: FLOW_MONTHS, staysFY26: staysFY26.length,
      typeMedians26: Object.fromEntries(HH.map((h) => [h.label, typeMedian(staysFY26, h.label)])),
      typeMedians25: Object.fromEntries(HH.map((h) => [h.label, typeMedian(staysFY25, h.label)])),
      blackPH: pct(phByRace26[0], exitsByRace26[0]), whitePH: pct(phByRace26[1], exitsByRace26[1]), blackRet: pct(retByRace26[0], cohortByRace26[0]), whiteRet: pct(retByRace26[1], cohortByRace26[1]), byGroup: flowByGroup }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 2. Behavioral health — CCBHC quality measures by site × month
// ═════════════════════════════════════════════════════════════════════════
function buildBh() {
  const s = stream("bh");
  const MONTHS = months("2025-01", 21); // Jan 2025 – Sep 2026
  const SITES = [
    { label: "Downtown", size: 1.35, eff: 0.04, mbc: true },
    { label: "Eastside", size: 1.0, eff: -0.035, mbc: false },
    { label: "Riverbend", size: 0.8, eff: 0.065, mbc: true },
    { label: "Northfield", size: 0.55, eff: -0.085, mbc: false }
  ];
  // measure: base rate, illustrative benchmark, monthly denominator per site
  const MEASURES = [
    { key: "I-SERV", label: "I-SERV: evaluation within 10 business days", base: 0.71, bench: 0.75, den: 58, siteMul: 1.0 },
    { key: "DEP-REM-6", label: "DEP-REM-6: depression remission at 6 months", base: 0.135, bench: 0.16, den: 42, siteMul: 0.55 },
    { key: "FUH-7", label: "FUH 7-day: follow-up after MH hospitalization", base: 0.36, bench: 0.38, den: 11, siteMul: 1.0, pair: "FUH" },
    { key: "FUH-30", label: "FUH 30-day: follow-up after MH hospitalization", base: 0.57, bench: 0.6, den: 11, siteMul: 1.0, pair: "FUH" },
    { key: "FUM-7", label: "FUM 7-day: follow-up after ED visit for MH", base: 0.41, bench: 0.4, den: 9, siteMul: 1.0, pair: "FUM" },
    { key: "FUM-30", label: "FUM 30-day: follow-up after ED visit for MH", base: 0.56, bench: 0.55, den: 9, siteMul: 1.0, pair: "FUM" },
    { key: "FUA-7", label: "FUA 7-day: follow-up after ED visit for AOD", base: 0.12, bench: 0.14, den: 8, siteMul: 0.8, pair: "FUA" },
    { key: "FUA-30", label: "FUA 30-day: follow-up after ED visit for AOD", base: 0.2, bench: 0.22, den: 8, siteMul: 0.8, pair: "FUA" },
    { key: "SRA-A", label: "SRA (adult): suicide risk assessment with MDD", base: 0.78, bench: 0.8, den: 30, siteMul: 0.6 },
    { key: "SRA-C", label: "SRA (child/adolescent): suicide risk assessment with MDD", base: 0.71, bench: 0.8, den: 12, siteMul: 0.6 }
  ];
  const mbcAt = MONTHS.indexOf(EVENTS.MEASUREMENT_BASED_CARE.month);
  const cells = []; // site × measure × month
  for (const site of SITES) for (const m of MEASURES) {
    // Paired 7/30 day measures share a draw so 30-day ≥ 7-day per cell.
    MONTHS.forEach((ym, i) => {
      const den = s.poisson(m.den * site.size);
      let p = m.base + site.eff * m.siteMul + 0.0016 * i + s.normal(0, 0.012);
      if (m.key === "DEP-REM-6" && site.mbc && i >= mbcAt) p += Math.min(0.06, 0.01 * (i - mbcAt + 1));
      cells.push({ site: site.label, measure: m.key, month: ym, den, p: clamp(p, 0.02, 0.97) });
    });
  }
  // enforce 30-day >= 7-day by drawing 7-day numerators as a subset
  const num = new Map();
  for (const c of cells) {
    const k = `${c.site}|${c.measure}|${c.month}`;
    if (/-7$/.test(c.measure)) continue;
    num.set(k, s.binom(c.den, c.p));
  }
  for (const c of cells) {
    if (!/-7$/.test(c.measure)) continue;
    const k30 = `${c.site}|${c.measure.replace("-7", "-30")}|${c.month}`;
    const c30 = cells.find((x) => `${x.site}|${x.measure}|${x.month}` === k30);
    c.den = c30.den; // same denominator events
    const n30 = num.get(k30);
    num.set(`${c.site}|${c.measure}|${c.month}`, s.binom(n30, c.p / c30.p));
  }
  for (const c of cells) c.num = num.get(`${c.site}|${c.measure}|${c.month}`);

  const last12 = MONTHS.slice(-12);
  const agg = (pred) => { const xs = cells.filter(pred); return { num: sum(xs.map((c) => c.num)), den: sum(xs.map((c) => c.den)) }; };
  const prior12 = MONTHS.slice(-21, -12); // 9 months of prior-period data available
  const measureRows = MEASURES.map((m) => {
    const cur = agg((c) => c.measure === m.key && last12.includes(c.month));
    const pri = agg((c) => c.measure === m.key && prior12.includes(c.month));
    return { m, cur, pri, rate: pct(cur.num, cur.den), prior: pct(pri.num, pri.den) };
  });
  const bhMeasureTable = measureRows.map(({ m, cur, rate, prior }) => ({
    measure: m.key, description: m.label.split(": ")[1], numerator: cur.num, denominator: cur.den, "rate %": rate,
    "benchmark %": r1(m.bench * 100), "gap (pts)": r1(rate - m.bench * 100), "prior period %": prior,
    note: cur.den < 20 ? "n<20: interpret with caution" : ""
  }));
  // Dot: gap to benchmark in points (higher is better for every measure here),
  // 7- and 30-day pairs adjacent (data order).
  const bhGapToBenchmark = measureRows.map(({ m, rate }) => ({ label: m.key, value: r1(rate - m.bench * 100), rate, benchmark: r1(m.bench * 100) }));

  const bhHeatmap = [];
  for (const m of MEASURES) for (const site of SITES) {
    const c = agg((x) => x.site === site.label && x.measure === m.key && last12.includes(x.month));
    bhHeatmap.push({ x: site.label, y: m.key, value: pct(c.num, c.den), numerator: c.num, denominator: c.den });
  }
  // DEP-REM-6 by site by quarter (shared scale)
  const QUARTERS = [...new Set(MONTHS.map(quarterOf))];
  const shortQ = (q) => `${q.slice(2, 4)}Q${q.slice(-1)}`; // "2025 Q3" -> "25Q3"
  const bhSiteTrends = [];
  for (const site of SITES) for (const q of QUARTERS) {
    const c = agg((x) => x.site === site.label && x.measure === "DEP-REM-6" && quarterOf(x.month) === q);
    bhSiteTrends.push({ facet: site.label, label: shortQ(q), quarter: q, value: pct(c.num, c.den), numerator: c.num, denominator: c.den });
  }
  // PHQ-9 outcome bands, trailing 12 months, % of index patients per site.
  // Remission count == DEP-REM-6 numerator, so the bands reconcile.
  const bhPhqBands = [];
  for (const site of SITES) {
    const c = agg((x) => x.site === site.label && x.measure === "DEP-REM-6" && last12.includes(x.month));
    const notReassessed = Math.round(c.den * (site.mbc ? 0.19 : 0.31) * (1 + s.normal(0, 0.05)));
    const response = Math.round((c.den - c.num - notReassessed) * (site.mbc ? 0.33 : 0.27));
    const none = c.den - c.num - notReassessed - response;
    for (const [series, n] of [["Remission (PHQ-9 < 5)", c.num], ["Response (≥50% drop, not remission)", response], ["No meaningful improvement", none], ["No 6-month PHQ-9 recorded", notReassessed]])
      bhPhqBands.push({ label: site.label, series, value: pct(n, c.den), patients: n, denominator: c.den });
  }
  // Days to first service: per-client waits (lognormal).
  const waits26 = Array.from({ length: 1480 }, () => Math.round(clamp(s.lognormal(8, 0.72), 0, 120)));
  const waits25 = Array.from({ length: 1390 }, () => Math.round(clamp(s.lognormal(10, 0.72), 0, 120)));
  const r = Object.fromEntries(measureRows.map((x) => [x.m.key, x]));
  const bhKpis = [
    { label: "Days to first service (median)", value: `${median(waits26)} days`, delta: `${signed(median(waits26) - median(waits25), 0, " days")} vs prior year · mean ${r1(mean(waits26))} · lower is better`, deltaDir: median(waits26) > median(waits25) ? "up" : "down", invert: true },
    { label: "Depression remission at 6 months (DEP-REM-6)", value: `${r["DEP-REM-6"].rate}%`, delta: `${signed(r["DEP-REM-6"].rate - r["DEP-REM-6"].prior, 1, " pts")} vs prior period · benchmark ${r1(MEASURES[1].bench * 100)}% · ${r["DEP-REM-6"].cur.num}/${r["DEP-REM-6"].cur.den}`, deltaDir: r["DEP-REM-6"].rate >= r["DEP-REM-6"].prior ? "up" : "down" },
    { label: "Follow-up within 30 days of MH hospitalization (FUH-30)", value: `${r["FUH-30"].rate}%`, delta: `${signed(r["FUH-30"].rate - r["FUH-30"].prior, 1, " pts")} vs prior · benchmark 60% · ${r["FUH-30"].cur.num}/${r["FUH-30"].cur.den}`, deltaDir: r["FUH-30"].rate >= r["FUH-30"].prior ? "up" : "down" },
    { label: "Follow-up within 30 days of ED visit (FUM-30 · FUA-30)", value: `${r["FUM-30"].rate}% · ${r["FUA-30"].rate}%`, delta: `benchmarks 55% · 22% · ${r["FUM-30"].cur.num}/${r["FUM-30"].cur.den} · ${r["FUA-30"].cur.num}/${r["FUA-30"].cur.den}` }
  ];
  const remissionRange = SITES.map((site) => { const c = agg((x) => x.site === site.label && x.measure === "DEP-REM-6" && last12.includes(x.month)); return pct(c.num, c.den); });
  const fuh30Sites = SITES.map((site) => { const c = agg((x) => x.site === site.label && x.measure === "FUH-30" && last12.includes(x.month)); return pct(c.num, c.den); });
  return {
    datasets: { bhKpis, bhGapToBenchmark, bhSiteTrends, bhSiteTrendLines: bhSiteTrends.map((r) => ({ date: r.label, series: r.facet, value: r.value, quarter: r.quarter, numerator: r.numerator, denominator: r.denominator })), bhHeatmap, bhPhqBands, bhMeasureTable, bhMeasureBriefTable: bhMeasureTable.map((r) => ({ measure: r.measure, "rate %": r["rate %"], "benchmark %": r["benchmark %"], "n / N": `${r.numerator} / ${r.denominator}` })) },
    facts: { remission: r["DEP-REM-6"].rate, remissionRange, fuh30Sites, iserv: r["I-SERV"].rate, waitMedian: median(waits26), waitMean: r1(mean(waits26)), measures: Object.fromEntries(measureRows.map((x) => [x.m.key, x.rate])) }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 3. Health center — UDS (5 annual years, quarterly estimates)
// ═════════════════════════════════════════════════════════════════════════
function buildUds() {
  const s = stream("uds");
  const YEARS = ["2021", "2022", "2023", "2024", "2025"];
  // label, 2025 rate, annual change, national comparator (illustrative), inverse?
  const SHORT_CQM = { "Controlling high blood pressure (<140/90)": "BP controlled", "Diabetes: HbA1c poor control (>9% or untested)": "Diabetes >9% (inv.)", "Colorectal cancer screening": "Colorectal screen", "Cervical cancer screening": "Cervical screen", "Childhood immunization status (by age 2)": "Child immunization", "Depression screening and follow-up plan": "Depression screen", "Tobacco use screening and cessation intervention": "Tobacco cessation", "Statin therapy for cardiovascular disease": "Statin therapy", "HIV screening (ages 15–65)": "HIV screening", "Early entry into prenatal care (first trimester)": "Prenatal, 1st tri." };
  const CQMS = [
    ["Controlling high blood pressure (<140/90)", 0.668, 0.011, 0.64, false, 0.23],
    ["Diabetes: HbA1c poor control (>9% or untested)", 0.304, -0.012, 0.3, true, 0.09],
    ["Colorectal cancer screening", 0.448, 0.019, 0.43, false, 0.31],
    ["Cervical cancer screening", 0.528, 0.006, 0.55, false, 0.18],
    ["Childhood immunization status (by age 2)", 0.342, 0.004, 0.37, false, 0.04],
    ["Depression screening and follow-up plan", 0.748, 0.021, 0.71, false, 0.62],
    ["Tobacco use screening and cessation intervention", 0.861, 0.006, 0.84, false, 0.58],
    ["Statin therapy for cardiovascular disease", 0.763, 0.009, 0.75, false, 0.16],
    ["HIV screening (ages 15–65)", 0.412, 0.024, 0.38, false, 0.52],
    ["Early entry into prenatal care (first trimester)", 0.702, -0.004, 0.73, false, 0.012]
  ];
  const patients = { 2021: 25120, 2022: 26040, 2023: 27180, 2024: 27930, 2025: 28655 };
  const udsCqm = [];
  for (const [label, r25, d, nat, inverse, denShare] of CQMS) {
    YEARS.forEach((y, i) => {
      const den = Math.round(patients[y] * denShare * (1 + s.normal(0, 0.01)));
      const p = clamp(r25 - d * (4 - i) + s.normal(0, 0.004), 0.02, 0.98);
      const n = s.binom(den, p);
      udsCqm.push({ measure: label, year: y, numerator: n, denominator: den, rate: pct(n, den), national: r1(nat * 100), inverse });
    });
  }
  const cur = (label, y = "2025") => udsCqm.find((r) => r.measure === label && r.year === y);
  const HEADLINE = ["Controlling high blood pressure (<140/90)", "Diabetes: HbA1c poor control (>9% or untested)", "Colorectal cancer screening", "Depression screening and follow-up plan"];
  const SHORT = { "Controlling high blood pressure (<140/90)": "BP controlled", "Diabetes: HbA1c poor control (>9% or untested)": "Diabetes poor control (lower is better)", "Colorectal cancer screening": "Colorectal screening", "Depression screening and follow-up plan": "Depression screening" };
  const udsCqmTrend = YEARS.flatMap((y) => HEADLINE.map((m) => ({ label: y, series: SHORT[m], value: cur(m, y).rate })));
  const udsVsNational = CQMS.map(([label, , , nat, inverse]) => {
    const r = cur(label);
    const gap = inverse ? r1(nat * 100 - r.rate) : r1(r.rate - nat * 100);
    return { label: SHORT_CQM[label], value: gap, measure: inverse ? `${label} (inverse: shown as national − centre)` : label, rate: r.rate, national: r1(nat * 100) };
  });
  const udsCqmTable = CQMS.map(([label, , , nat, inverse]) => {
    const r = cur(label), p = cur(label, "2024");
    return { measure: label, "better when": inverse ? "lower" : "higher", numerator: r.numerator, denominator: r.denominator, "2025 %": r.rate, "2024 %": p.rate, "change (pts)": r1(r.rate - p.rate), "national % (illustrative)": r1(nat * 100) };
  });
  // Payer mix by year (% of patients); explicit unknown row so parts sum to 100.
  const PAYER = [["Medicaid/CHIP", 0.462, -0.004], ["Uninsured", 0.214, -0.006], ["Medicare", 0.118, 0.003], ["Private insurance", 0.168, 0.006], ["Other public", 0.021, 0.0], ["Payer unknown", 0.017, 0.001]];
  const udsPayerMix = [];
  YEARS.forEach((y, i) => {
    const vals = PAYER.map(([, b, d]) => b - d * (4 - i) + s.normal(0, 0.002));
    const t = sum(vals);
    const rounded = vals.map((v) => r1((100 * v) / t));
    rounded[0] = r1(rounded[0] + 100 - sum(rounded));
    PAYER.forEach(([series], k) => udsPayerMix.push({ label: y, series, value: rounded[k] }));
  });
  const LINES = [["Medical", 0.618], ["Dental", 0.156], ["Behavioral health", 0.112], ["Enabling services (case management, outreach)", 0.061], ["Substance use disorder", 0.031], ["Vision", 0.022]];
  const visits25 = 113_480;
  const udsServiceLines = LINES.map(([label, sh]) => ({ label, value: Math.round(visits25 * sh * (1 + s.normal(0, 0.01))) }));
  const fpl = { below100: 0.611, to200: 0.268, above200: 0.083, unknown: 0.038 };
  const htn = cur(HEADLINE[0]), htnP = cur(HEADLINE[0], "2024");
  // quarterly in-year estimates (2026, provisional)
  const udsQuarterly = ["2026 Q1", "2026 Q2", "2026 Q3"].map((q, i) => {
    const den = Math.round(patients[2025] * 0.23 * 1.01);
    const n = s.binom(den, htn.rate / 100 + 0.004 * (i + 1));
    return { quarter: q, measure: HEADLINE[0], numerator: n, denominator: den, rate: pct(n, den), status: "provisional estimate" };
  });
  const udsKpis = [
    { label: "Patients served, 2025", value: commas(patients[2025]), delta: `${signed(100 * (patients[2025] / patients[2024] - 1), 1, "%")} vs 2024 (neutral)` },
    { label: "Visits, 2025", value: commas(sum(udsServiceLines.map((r) => r.value))), delta: `${r1(sum(udsServiceLines.map((r) => r.value)) / patients[2025])} visits per patient` },
    { label: "Patients at or below 200% FPL", value: `${r1(100 * (fpl.below100 + fpl.to200))}%`, delta: `of patients with known income · income unknown for ${r1(fpl.unknown * 100)}%` },
    { label: "Hypertension controlled (<140/90)", value: `${htn.rate}%`, delta: `${signed(htn.rate - htnP.rate, 1, " pts")} vs 2024 · national ${htn.national}% · ${commas(htn.numerator)}/${commas(htn.denominator)} · 2026 Q3 est. ${udsQuarterly.at(-1).rate}%`, deltaDir: htn.rate >= htnP.rate ? "up" : "down" }
  ];
  return {
    datasets: { udsKpis, udsCqmTrend, udsVsNational, udsPayerMix, udsServiceLines, udsCqmTable, udsQuarterly, udsCqm },
    facts: { htn: htn.rate, dmPoor: cur(HEADLINE[1]).rate }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 4. Overdose & SUD surveillance
// ═════════════════════════════════════════════════════════════════════════
function buildOverdose() {
  const s = stream("overdose");
  const MONTHS = months("2019-01", 93); // Jan 2019 – Sep 2026
  const at = (ym) => MONTHS.indexOf(ym);
  const fent = at(EVENTS.FENTANYL_EMERGENCE.month), xyl = at(EVENTS.XYLAZINE_DETECTED.month), nal = at(EVENTS.NALOXONE_PROGRAMME.month);
  const expected = MONTHS.map((ym, i) => {
    let lam = 6.2 + 0.02 * i;
    if (i >= fent) lam += Math.min(8.5, 0.32 * (i - fent));
    if (i >= xyl) lam += Math.min(2.2, 0.12 * (i - xyl));
    if (i >= nal) lam -= Math.min(6.4, 0.3 * (i - nal));
    lam *= 1 + 0.06 * Math.cos((2 * Math.PI * (i - 6)) / 12);
    return Math.max(2.5, lam);
  });
  const deaths = expected.map((lam) => clamp(s.poisson(lam), 3, 25));
  const PROVISIONAL_MONTHS = 6;
  const rolling = MONTHS.map((ym, i) => (i < 11 ? null : r1((sum(deaths.slice(i - 11, i + 1)) / COUNTY_POP) * 100000)));
  const odRollingRate = [];
  MONTHS.forEach((ym, i) => {
    if (rolling[i] == null) return;
    if (i <= MONTHS.length - PROVISIONAL_MONTHS) odRollingRate.push({ date: ym, value: rolling[i], series: "12-month rate, final" });
    if (i >= MONTHS.length - PROVISIONAL_MONTHS) odRollingRate.push({ date: ym, value: rolling[i], series: "Provisional (death certificates pending)" });
  });
  // Nonfatal ED visits: larger, faster, leads deaths by ~2 months.
  const ed = MONTHS.map((ym, i) => s.poisson(expected[Math.min(MONTHS.length - 1, i + 2)] * 7.4 + 8));
  const odEdVisits = MONTHS.slice(-36).map((ym, k) => ({ date: ym, value: ed[MONTHS.length - 36 + k] }));
  // Substance involvement (not mutually exclusive) — annual rates per 100k.
  const YEARS = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"];
  const share = (sub, i) => {
    const t = i / (MONTHS.length - 1);
    if (sub === "Fentanyl") return i < fent ? 0.38 : Math.min(0.82, 0.38 + 0.02 * (i - fent));
    if (sub === "Heroin") return Math.max(0.05, 0.36 - 0.006 * i);
    if (sub === "Methamphetamine") return 0.22 + 0.2 * t;
    if (sub === "Cocaine") return 0.17 + 0.05 * t;
    if (sub === "Prescription opioids") return Math.max(0.07, 0.22 - 0.0016 * i);
    if (sub === "Xylazine") return i < xyl ? 0 : Math.min(0.24, 0.016 * (i - xyl));
    return 0;
  };
  const SUBS = ["Fentanyl", "Methamphetamine", "Cocaine", "Heroin", "Prescription opioids", "Xylazine"];
  const involvement = SUBS.map((sub) => MONTHS.map((ym, i) => s.binom(deaths[i], share(sub, i))));
  const odBySubstance = [];
  SUBS.forEach((sub, k) => YEARS.forEach((y) => {
    const idx = MONTHS.map((ym, i) => (ym.startsWith(y) ? i : -1)).filter((i) => i >= 0);
    const n = sum(idx.map((i) => involvement[k][i]));
    odBySubstance.push({ facet: sub, label: y, value: r1((n / COUNTY_POP) * 100000), deaths: n });
  }));
  // State death rates (synthetic), spread ~6.5×, counts present.
  const pops = statePopulations(s);
  const rates = spreadRates(s, 11.2, 73.5);
  const odStateRates = STATES.map(([id, state], i) => ({ id, label: state, state, value: r1(rates[i]), deaths: Math.round((rates[i] * pops[i]) / 100000), population: pops[i] }));
  const last12Deaths = sum(deaths.slice(-12)), prior12Deaths = sum(deaths.slice(-24, -12));
  const naloxone = MONTHS.slice(-12).map((ym, k) => s.poisson(118 + 3 * k));
  const naloxonePrior = MONTHS.slice(-24, -12).map(() => s.poisson(84));
  const moud = 2_310 + Math.round(s.normal(0, 25)), moudPrior = 1_985;
  const odKpis = [
    { label: "Overdose deaths per 100k (last 12 months, provisional)", value: `${rolling.at(-1)}`, delta: `${signed(rolling.at(-1) - rolling.at(-13), 1)} vs a year earlier · ${last12Deaths} deaths · lower is better`, deltaDir: rolling.at(-1) > rolling.at(-13) ? "up" : "down", invert: true },
    { label: "Nonfatal overdose ED visits (last 12 months)", value: commas(sum(ed.slice(-12))), delta: `${signed(100 * (sum(ed.slice(-12)) / sum(ed.slice(-24, -12)) - 1), 1, "%")} vs prior 12 months · leading indicator`, deltaDir: sum(ed.slice(-12)) > sum(ed.slice(-24, -12)) ? "up" : "down", invert: true },
    { label: "Naloxone administrations by EMS (last 12 months)", value: commas(sum(naloxone)), delta: `${signed(100 * (sum(naloxone) / sum(naloxonePrior) - 1), 1, "%")} vs prior 12 months (context: reflects both need and reach)` },
    { label: "People receiving MOUD (Sep 2026)", value: commas(moud), delta: `${signed(100 * (moud / moudPrior - 1), 1, "%")} vs Sep 2025 · higher is better`, deltaDir: moud >= moudPrior ? "up" : "down" }
  ];
  return {
    datasets: { odKpis, odRollingRate, odEdVisits, odStateRates, odBySubstance, odBySubstanceTrend: odBySubstance.map((r) => ({ date: r.label, series: r.facet, value: r.value, deaths: r.deaths })), odMonthly: MONTHS.map((ym, i) => ({ month: ym, deaths: deaths[i], edVisits: ed[i], provisional: i >= MONTHS.length - PROVISIONAL_MONTHS })) },
    facts: { deathsRange: [Math.min(...deaths), Math.max(...deaths)], stateSpread: r2(Math.max(...rates) / Math.min(...rates)), rollingNow: rolling.at(-1), peak: Math.max(...rolling.filter((v) => v != null)), last12Deaths, prior12Deaths }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 5. Community health by place (County Health Rankings-style framing)
// ═════════════════════════════════════════════════════════════════════════
function buildCommunity() {
  const s = stream("community");
  const pops = statePopulations(s).map((p) => Math.round(p * 0.61)); // adults 19–64
  // Uninsured adults 19–64: spread ~6.6×.
  const unins = spreadRates(s, 3.6, 23.8);
  const chStateRates = STATES.map(([id, state], i) => ({ id, label: state, state, value: r1(unins[i]), uninsured: Math.round((unins[i] / 100) * pops[i]), "adults 19–64": pops[i] }));
  // Premature death (deaths before 75 per 100k), correlated with uninsured
  // but with plenty of scatter (and confounding we name in the annotation).
  const chScatter = STATES.map(([id, state], i) => ({ x: r1(unins[i]), y: Math.round(255 + 9.5 * unins[i] + s.normal(0, 48)), group: i % 4 === 0 ? "Northeast" : i % 4 === 1 ? "South" : i % 4 === 2 ? "Midwest" : "West", state }));
  // fix regions by a deterministic geographic grouping
  const REGION = { Northeast: ["09", "23", "25", "33", "34", "36", "42", "44", "50"], Midwest: ["17", "18", "19", "20", "26", "27", "29", "31", "38", "39", "46", "55"], South: ["01", "05", "10", "11", "12", "13", "21", "22", "24", "28", "37", "40", "45", "47", "48", "51", "54"], West: ["02", "04", "06", "08", "15", "16", "30", "32", "35", "41", "49", "53", "56"] };
  const regionOf = (id) => Object.keys(REGION).find((r) => REGION[r].includes(id));
  chScatter.forEach((row, i) => { row.group = regionOf(STATES[i][0]); });
  const usUnins = r1((100 * sum(chStateRates.map((r) => r.uninsured))) / sum(pops));
  const FACTORS = [
    ["Adult smoking (%)", 16.8, 14.9, 13.2],
    ["Adult obesity (%)", 36.4, 34.1, 33.0],
    ["Physical inactivity (%)", 25.9, 23.2, 22.6],
    ["Uninsured adults 19–64 (%)", 11.8, 10.9, usUnins],
    ["Children in poverty (%)", 19.6, 16.4, 16.3],
    ["Severe housing cost burden (%)", 17.2, 13.8, 14.3]
  ];
  // Short names for the landscape grouped bar; the full name stays in `factor`.
  const FACTOR_SHORT = { "Adult smoking (%)": "Smoking", "Adult obesity (%)": "Obesity", "Physical inactivity (%)": "Inactivity", "Uninsured adults 19–64 (%)": "Uninsured", "Children in poverty (%)": "Child poverty", "Severe housing cost burden (%)": "Housing burden" };
  const chFactors = FACTORS.flatMap(([facet, county, state, us]) => [
    { facet, label: "Meridian County", value: county },
    { facet, label: "State", value: state },
    { facet, label: "United States", value: us }
  ]);
  const pd = { county: 412, state: 371, us: 361, countyDeaths: Math.round((412 / 100000) * COUNTY_POP * 0.86), prior: 425 };
  const chKpis = [
    { label: "Premature deaths per 100k (before age 75), Meridian", value: String(pd.county), delta: `${signed(pd.county - pd.prior, 0)} vs prior 3-year period · ${commas(pd.countyDeaths)} deaths · lower is better`, deltaDir: pd.county > pd.prior ? "up" : "down", invert: true },
    { label: "State comparator", value: String(pd.state), delta: `Meridian is ${r1(100 * (pd.county / pd.state - 1))}% higher than the state` },
    { label: "U.S. comparator", value: String(pd.us), delta: `Meridian is ${r1(100 * (pd.county / pd.us - 1))}% higher than the U.S.` },
    { label: "Uninsured adults 19–64, Meridian", value: "11.8%", delta: `state 10.9% · U.S. ${usUnins}% · lower is better`, deltaDir: "up", invert: true }
  ];
  const chTable = chStateRates.map((r, i) => ({ state: r.state, fips: r.id, "uninsured adults": r.uninsured, "adults 19–64": r["adults 19–64"], "uninsured %": r.value, "premature deaths per 100k": chScatter[i].y }));
  return {
    datasets: { chKpis, chStateRates, chFactors, chFactorsCompared: chFactors.map((r) => ({ label: FACTOR_SHORT[r.facet], series: r.label, value: r.value, factor: r.facet })), chScatter, chTable },
    facts: { spread: r2(Math.max(...unins) / Math.min(...unins)), corr: r2(correlation(chScatter.map((r) => r.x), chScatter.map((r) => r.y))) }
  };
}
function correlation(xs, ys) { const mx = mean(xs), my = mean(ys); let n = 0, dx = 0, dy = 0; for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return n / Math.sqrt(dx * dy); }

// ═════════════════════════════════════════════════════════════════════════
// 6. Program outcomes & funder report
// ═════════════════════════════════════════════════════════════════════════
function buildPrograms() {
  const s = stream("programs");
  const QUARTERS = ["2024 Q1", "2024 Q2", "2024 Q3", "2024 Q4", "2025 Q1", "2025 Q2", "2025 Q3", "2025 Q4", "2026 Q1", "2026 Q2", "2026 Q3"];
  const GOAL = 150;
  const enrol = series(s, QUARTERS.length, { base: 118, trend: 3.4, seasonAmp: 9, seasonPeak: 2, period: 4, noise: 6 }).map(Math.round);
  const poEnrollments = QUARTERS.map((q, i) => ({ label: q, value: enrol[i] }));
  const PROGRAMS = [
    ["Housing Stability", ["Downtown", "Eastside", "Riverbend"], 0.64],
    ["Youth Employment", ["Downtown", "Northfield"], 0.57],
    ["Peer Recovery Coaching", ["Eastside", "Riverbend", "Northfield"], 0.61]
  ];
  const attain = [];
  const effects = { Downtown: 0.05, Eastside: -0.03, Riverbend: 0.02, Northfield: -0.07 };
  for (const [prog, sites, base] of PROGRAMS) for (const site of sites) {
    const n = Math.round(150 + s.rand() * 210);
    const k = s.binom(n, clamp(base + effects[site] + s.normal(0, 0.015), 0.2, 0.95));
    attain.push({ facet: prog, label: site, value: pct(k, n), achieved: k, participants: n });
  }
  const overall = pct(sum(attain.map((r) => r.achieved)), sum(attain.map((r) => r.participants)));
  const COHORTS = [["2024 spring", 0.9], ["2024 fall", 1.1], ["2025 spring", 1.4], ["2025 fall", 1.6], ["2026 spring", 1.3]];
  const poPrePost = COHORTS.map(([c, d]) => { const n = Math.round(38 + s.rand() * 30); return { label: `${c.split(" ")[1][0].toUpperCase()}${c.split(" ")[1].slice(1)} '${c.slice(2, 4)} (n=${n})`, cohort: `${c} cohort`, value: r1(d + s.normal(0, 0.12)), n, measure: "Self-sufficiency matrix, mean change (pre → post, points)" }; });
  const DEMO = [["Black", 46.2, 31.5], ["White", 30.1, 47.8], ["Hispanic/Latino", 15.4, 13.1], ["Asian", 1.6, 3.6], ["Multiracial / another race", 4.9, 4.0], ["Not reported", 1.8, 0]];
  const poDemographics = DEMO.flatMap(([label, p, a]) => [{ label, series: "Participants", value: p }, { label, series: "Service-area residents", value: a }]);
  const served = sum(enrol.slice(-8, -4)) + sum(enrol.slice(-4)); // last 2 program years
  const servedYear = sum(enrol.slice(-4)), goalYear = GOAL * 4;
  // Round after the addition: 72.4 + 0.x is not exactly representable, and
  // the KPI row prints this value as given (PR #42 review, B1).
  const completion = r1(72.4 + r1(s.normal(0, 0.5)));
  const cost = 3_940;
  const poKpis = [
    { label: "Served, last 4 quarters", value: commas(servedYear), delta: `${pct(servedYear, goalYear)}% of goal (${commas(goalYear)}) · ${signed(servedYear - sum(enrol.slice(-8, -4)), 0)} vs prior 4 quarters`, deltaDir: servedYear >= sum(enrol.slice(-8, -4)) ? "up" : "down" },
    { label: "Program completion", value: `${completion}%`, delta: "of participants who exited · goal 75%", deltaDir: "down" },
    { label: "Achieved primary outcome", value: `${overall}%`, delta: `${commas(sum(attain.map((r) => r.achieved)))} of ${commas(sum(attain.map((r) => r.participants)))} · goal 60%`, deltaDir: overall >= 60 ? "up" : "down" },
    { label: "Cost per outcome achieved", value: `$${commas(cost)}`, delta: "▼ $310 vs prior year · lower is better", deltaDir: "down", invert: true }
  ];
  return {
    datasets: { poKpis, poEnrollments, poAttainment: attain, poPrePost, poDemographics },
    facts: { spread: r1(Math.max(...attain.map((r) => r.value)) - Math.min(...attain.map((r) => r.value))), overall, goal: GOAL }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 7. City services — 311 (per-request simulation, aggregated)
// ═════════════════════════════════════════════════════════════════════════
function buildCs311() {
  const s = stream("311");
  const END = dayNum(AS_OF), START = END - 149; // 150 days
  const TYPES = [
    // label, share, median days to close, sigma, target days, short chart label
    ["Missed trash or recycling pickup", 0.205, 1.1, 1.3, 2, "Trash pickup"],
    ["Pothole", 0.168, 4.2, 1.42, 7, "Pothole"],
    ["Streetlight out", 0.121, 6.0, 1.5, 10, "Streetlight"],
    ["Illegal dumping", 0.094, 4.8, 1.48, 7, "Illegal dumping"],
    ["Graffiti removal", 0.081, 3.4, 1.46, 5, "Graffiti"],
    ["Abandoned vehicle", 0.072, 7.0, 1.68, 14, "Abandoned car"],
    ["Noise complaint", 0.069, 0.6, 1.35, 1, "Noise"],
    ["Sidewalk repair", 0.064, 9.0, 1.9, 30, "Sidewalk"],
    ["Tree or limb down", 0.068, 2.4, 1.35, 3, "Tree/limb down"],
    ["Water leak or main break", 0.058, 1.4, 1.3, 2, "Water leak"]
  ];
  const DISTRICTS = ["District 1", "District 2", "District 3", "District 4", "District 5", "District 6", "District 7"];
  const DIST_W = [1.2, 1.05, 0.9, 1.15, 0.8, 1.0, 0.9];
  const DIST_SPEED = [1.0, 0.9, 1.25, 1.1, 0.85, 1.4, 1.05];
  const HOUR_W = Array.from({ length: 24 }, (_, h) => (h < 6 ? 0.15 : h < 8 ? 0.6 : h < 12 ? 1.6 : h < 17 ? 1.25 : h < 21 ? 0.7 : 0.3));
  const storm = dayNum(EVENTS.JULY_STORM.date);
  const reqs = [];
  for (let d = START; d <= END; d++) {
    const wd = weekday(d);
    const weekly = [1.18, 1.1, 1.06, 1.02, 0.98, 0.72, 0.6][wd];
    const season = 1 + 0.08 * Math.cos((2 * Math.PI * (d - dayNum("2026-07-20"))) / 365);
    const base = 236 * weekly * season;
    TYPES.forEach(([label, sh, med, sig, target], t) => {
      let lam = base * sh;
      if ((label === "Tree or limb down" || label === "Water leak or main break") && d >= storm && d < storm + 10) lam *= [6, 5, 4, 3, 2.4, 2, 1.6, 1.4, 1.2, 1.1][d - storm];
      if (label === "Noise complaint") lam *= wd >= 5 ? 1.9 : 1;
      const n = s.poisson(lam);
      for (let k = 0; k < n; k++) {
        const di = s.pick(DIST_W);
        const hour = label === "Noise complaint" ? (s.rand() < 0.6 ? 21 + Math.floor(s.rand() * 3) : s.pick(HOUR_W)) : s.pick(HOUR_W);
        const backlogSlow = label === "Sidewalk repair" ? 1 : 1;
        const dur = s.lognormal(med * DIST_SPEED[di] * backlogSlow, sig);
        const closeDay = d + dur;
        reqs.push({ t, di, day: d, wd, hour, dur, closed: closeDay <= END + 0.999, closeDay: Math.floor(closeDay), target });
      }
    });
  }
  const daily = [];
  const openedBy = new Map(), closedBy = new Map();
  for (const r of reqs) { openedBy.set(r.day, (openedBy.get(r.day) || 0) + 1); if (r.closed) closedBy.set(r.closeDay, (closedBy.get(r.closeDay) || 0) + 1); }
  for (let d = START; d <= END; d++) {
    daily.push({ date: isoDay(d), value: openedBy.get(d) || 0, series: "Opened" });
    daily.push({ date: isoDay(d), value: closedBy.get(d) || 0, series: "Closed" });
  }
  const closedReqs = reqs.filter((r) => r.closed);
  const byType = TYPES.map(([label, , , , target, short], t) => {
    const all = reqs.filter((r) => r.t === t), cl = closedReqs.filter((r) => r.t === t);
    const durs = cl.map((r) => r.dur);
    const onTime = cl.filter((r) => r.dur <= target).length;
    return { label, short, opened: all.length, closed: cl.length, open: all.length - cl.length, target, median: r1(median(durs)), mean: r1(mean(durs)), onTimePct: pct(onTime, cl.length) };
  });
  const cs311Types = byType.map((r) => ({ label: r.short, value: r.opened, type: r.label }));
  const DOT = { "Trash pickup": "Trash", "Streetlight": "Light", "Illegal dumping": "Dumping", "Abandoned car": "Car", "Tree/limb down": "Tree", "Water leak": "Water", "Sidewalk": "Walk" };
  const cs311CloseVsTarget = byType.map((r) => ({ label: `${DOT[r.short] || r.short} (${r.target}d)`, type: r.label, value: Math.round((100 * r.median) / r.target), "median days": r.median, "target days": r.target }));
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heat = new Map();
  for (const r of reqs) { const k = `${r.wd}|${r.hour}`; heat.set(k, (heat.get(k) || 0) + 1); }
  const cs311Heatmap = [];
  // 3-hour blocks keep the axis legible: "0–3h" … "21–24h".
  for (let wd = 0; wd < 7; wd++) for (let b = 0; b < 8; b++) cs311Heatmap.push({ x: `${b * 3}–${b * 3 + 3}h`, y: WD[wd], value: [0, 1, 2].reduce((n, k) => n + (heat.get(`${wd}|${b * 3 + k}`) || 0), 0) });
  const cs311District = DISTRICTS.map((label, di) => ({ label, value: Math.round(24 * median(closedReqs.filter((r) => r.di === di).map((r) => r.dur))), "median days": r1(median(closedReqs.filter((r) => r.di === di).map((r) => r.dur))), requests: reqs.filter((r) => r.di === di).length }));
  const cs311Table = byType.map((r) => ({ "request type": r.label, opened: r.opened, closed: r.closed, "still open": r.open, "target (days)": r.target, "% closed within target": r.onTimePct, "median days to close": r.median, "mean days to close": r.mean }));
  const opened = reqs.length, closed = closedReqs.length;
  const onTimeAll = pct(closedReqs.filter((r) => r.dur <= r.target).length, closed);
  const medAll = r1(median(closedReqs.map((r) => r.dur))), meanAll = r1(mean(closedReqs.map((r) => r.dur)));
  const last30 = reqs.filter((r) => r.day > END - 30), prev30 = reqs.filter((r) => r.day > END - 60 && r.day <= END - 30);
  const cs311Kpis = [
    { label: "Requests opened (150 days)", value: commas(opened), delta: `${signed(100 * (last30.length / prev30.length - 1), 1, "%")} last 30 days vs prior 30 (neutral)` },
    { label: "Requests closed", value: commas(closed), delta: `${pct(closed, opened)}% of opened · recent requests still in progress` },
    { label: "Closed within target", value: `${onTimeAll}%`, delta: "goal 80% · type-specific targets · higher is better", deltaDir: onTimeAll >= 80 ? "up" : "down" },
    { label: "Median days to close (administrative)", value: `${medAll} days`, delta: `mean ${meanAll} days · long-tail requests pull the mean · lower is better` },
    { label: "Open backlog (as of Oct 31)", value: commas(opened - closed), delta: `${commas(reqs.filter((r) => !r.closed && r.day < END - 30).length)} open longer than 30 days · lower is better`, deltaDir: "up", invert: true }
  ];
  const typeShares = byType.map((r) => r.opened).sort((a, b) => b - a);
  return {
    datasets: { cs311Kpis, cs311Daily: daily, cs311Types, cs311CloseVsTarget, cs311Heatmap, cs311District, cs311Table, cs311BriefTable: cs311Table.map((r) => ({ type: cs311CloseVsTarget.find((c) => c.type === r["request type"])?.label ?? r["request type"], opened: r.opened, "% on time": r["% closed within target"], "median days": r["median days to close"] })) },
    facts: { top3: pct(sum(typeShares.slice(0, 3)), opened), meanToMedian: byType.map((r) => [r.label, r2(r.mean / r.median)]), onTimeAll, medAll, meanAll, opened, closed }
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 8. Performance scorecard (reuses the CoC / BH / UDS / 311 numbers)
// ═════════════════════════════════════════════════════════════════════════
function buildScorecard(coc, bh, uds, cs) {
  const s = stream("scorecard");
  // perspective, measure, actual, target, unit, better
  const M = [
    ["Clients & community", "Exits to permanent housing (CoC M7b.1)", coc.facts.phPct26, 45, "%", "higher"],
    ["Clients & community", "Returns to homelessness within 12 months (CoC M2)", coc.facts.ret12Pct26, 10, "%", "lower"],
    ["Clients & community", "Hypertension controlled (UDS)", uds.facts.htn, 65, "%", "higher"],
    ["Clients & community", "Depression remission at 6 months (DEP-REM-6)", bh.facts.remission, 16, "%", "higher"],
    ["Internal process", "Median days to first BH service", bh.facts.waitMedian, 10, "days", "lower"],
    ["Internal process", "311 requests closed within target", cs.facts.onTimeAll, 80, "%", "higher"],
    ["Internal process", "HMIS exit destination recorded (not DK/refused/missing)", r1(100 - coc.facts.unknownExitPct), 95, "%", "higher"],
    ["Learning & growth", "Direct-service staff vacancy rate", 14.2, 10, "%", "lower"],
    ["Learning & growth", "Staff completing trauma-informed care training", 88.5, 90, "%", "higher"],
    ["Financial stewardship", "Grant spend-down vs plan (year to date)", 96.4, 100, "%", "higher"],
    ["Financial stewardship", "Cost per exit to permanent housing", 8_420, 8_000, "$", "lower"],
    ["Financial stewardship", "Days cash on hand", 74, 60, "days", "higher"]
  ];
  const ratio = (actual, target, better) => (better === "higher" ? (100 * actual) / target : (100 * target) / actual);
  const status = (p) => (p >= 100 ? "On target" : p >= 90 ? "At risk" : "Off target");
  const fmtVal = (v, unit) => (unit === "$" ? `$${commas(v)}` : unit === "%" ? `${v}%` : `${v} ${unit}`);
  const scTable = M.map(([perspective, measure, actual, target, unit, better]) => {
    const p = r1(ratio(actual, target, better));
    return { perspective, measure, actual: fmtVal(actual, unit), target: fmtVal(target, unit), variance: unit === "$" ? `${actual - target >= 0 ? "+" : "−"}$${commas(Math.abs(actual - target))}` : `${actual - target >= 0 ? "+" : "−"}${r1(Math.abs(actual - target))}${unit === "%" ? " pts" : ` ${unit}`}`, "better when": better, "% of target": p, status: `${status(p)} (${p}% of target)` };
  });
  const SHORT_M = ["Exits to PH", "Returns ≤12 mo", "BP controlled", "Remission 6 mo", "Days to BH care", "311 on time", "HMIS complete", "Staff vacancy", "Training done", "Grant spend-down", "Cost per PH exit", "Days cash"];
  const scPctTarget = M.map(([, measure, actual, target, , better], i) => ({ label: SHORT_M[i], value: r1(ratio(actual, target, better)), measure }));
  const counts = { "On target": 0, "At risk": 0, "Off target": 0 };
  for (const r of scPctTarget) counts[status(r.value)]++;
  const scKpis = [
    { label: "Measures on target (≥100% of target)", value: `${counts["On target"]} of ${M.length}`, delta: "▲ 1 vs last quarter", deltaDir: "up" },
    { label: "At risk (90–99.9% of target)", value: String(counts["At risk"]), delta: "■ 0 vs last quarter" },
    { label: "Off target (<90% of target)", value: String(counts["Off target"]), delta: "▼ 1 vs last quarter · fewer is better", deltaDir: "down", invert: true }
  ];
  const QUARTERS = ["2025 Q4", "2026 Q1", "2026 Q2", "2026 Q3"];
  const PERSP = ["Clients & community", "Internal process", "Learning & growth", "Financial stewardship"];
  const scPerspectiveTrend = [];
  for (const p of PERSP) {
    const cur = scPctTarget.filter((r, i) => M[i][0] === p);
    const now = r1(mean(cur.map((r) => Math.min(r.value, 120))));
    QUARTERS.forEach((q, i) => scPerspectiveTrend.push({ facet: p, label: `${q.slice(2, 4)}Q${q.slice(-1)}`, value: i === QUARTERS.length - 1 ? now : r1(now - (QUARTERS.length - 1 - i) * (1.1 + Math.abs(s.normal(0, 0.4)))) })); // steady quarterly gains (title claims improvement every quarter)
  }
  return { datasets: { scKpis, scTable, scPctTarget, scPerspectiveTrend, scPerspectiveTrendLines: scPerspectiveTrend.map((r) => ({ date: r.label, series: r.facet, value: r.value })) }, facts: { counts } };
}

// ═════════════════════════════════════════════════════════════════════════
// 9. General families: executive + sales (for the two general templates)
// ═════════════════════════════════════════════════════════════════════════
function buildExecutive() {
  const s = stream("executive");
  const M = months("2025-01", 22); // Jan 2025 – Oct 2026
  const rev = series(s, 22, { base: 1.82, trend: 0.012, seasonAmp: 0.11, seasonPeak: 11, noise: 0.03 }).map((v) => r2(v));
  const exRevenue = [];
  M.slice(12).forEach((ym, k) => {
    exRevenue.push({ date: ym, value: rev[12 + k], series: "2026 revenue ($M)" });
    exRevenue.push({ date: ym, value: rev[k], series: "2025, same month ($M)" });
  });
  const FUNCS = [["Sales", 4.1, 3.9], ["Marketing", 1.2, 1.3], ["Operations", 5.6, 5.4], ["Customer success", 1.9, 2.0], ["People", 0.9, 0.95], ["Technology", 2.7, 2.5]];
  const exBudget = FUNCS.flatMap(([label, b, a]) => [{ label, series: "Budget YTD ($M)", value: b }, { label, series: "Actual YTD ($M)", value: r1(a + s.normal(0, 0.03)) }]);
  const ytd26 = sum(rev.slice(12)), ytd25 = sum(rev.slice(0, 10));
  const exKpis = [
    { label: "Revenue YTD (Finance)", value: `$${r1(ytd26)}M`, delta: `${signed(100 * (ytd26 / ytd25 - 1), 1, "%")} vs 2025 YTD · plan $19.6M`, deltaDir: ytd26 >= ytd25 ? "up" : "down" },
    { label: "Gross margin (Finance)", value: "61.8%", delta: "▲ 1.2 pts vs 2025 · target 60%", deltaDir: "up" },
    { label: "Net revenue retention (Customer success)", value: "104%", delta: "▼ 2 pts vs Q2 · target 105%", deltaDir: "down" },
    { label: "On-time delivery (Operations)", value: "93.4%", delta: "▲ 0.8 pts vs Q2 · target 95%", deltaDir: "up" },
    { label: "Voluntary turnover, annualized (People)", value: "11.2%", delta: "▼ 1.5 pts vs 2025 · lower is better", deltaDir: "down", invert: true }
  ];
  const exByFunction = FUNCS.map(([label, b]) => { const a = exBudget.find((r) => r.label === label && r.series.startsWith("Actual")).value; return { label, value: r1((100 * a) / b) }; });
  return { datasets: { exKpis, exRevenue, exBudget, exByFunction }, facts: {} };
}

function buildSales() {
  const s = stream("sales");
  const M = months("2024-11", 24); // Nov 2024 – Oct 2026
  const book = series(s, 24, { base: 610, trend: 6, seasonAmp: 70, seasonPeak: 1, noise: 35 }).map(Math.round); // $k
  const slBookings = [];
  M.slice(12).forEach((ym, k) => { slBookings.push({ date: ym, value: book[12 + k], series: "Last 12 months ($k)" }); slBookings.push({ date: ym, value: book[k], series: "Prior year, same month ($k)" }); });
  const REPS = ["A. Okafor", "B. Lindqvist", "C. Ramírez", "D. Chen", "E. Haddad", "F. Novak", "G. Mensah", "H. Silva", "I. Tanaka", "J. Byrne"];
  const slQuota = REPS.map((label) => ({ label, value: Math.round(clamp(s.normal(97, 17), 58, 138)) }));
  const STAGES = [["Prospecting", 3.9], ["Qualified", 2.6], ["Proposal", 1.7], ["Negotiation", 0.9], ["Verbal commit", 0.45]];
  const slPipeline = STAGES.map(([label, v]) => ({ label, value: r1(v + s.normal(0, 0.05)) })); // $M
  const SEG = [["SMB", 18, 34, 0.5], ["Mid-market", 62, 71, 0.45], ["Enterprise", 240, 128, 0.4]];
  const slDeals = [];
  for (let i = 0; i < 120; i++) { const [g, size, cycle, sig] = SEG[s.pick([0.5, 0.33, 0.17])]; const sz = Math.round(s.lognormal(size, sig)); slDeals.push({ x: sz, y: Math.round(clamp(cycle * Math.pow(sz / size, 0.45) * Math.exp(s.normal(0, 0.25)), 7, 365)), group: g }); }
  const last12 = sum(book.slice(12)), prior12 = sum(book.slice(0, 12));
  const pipe = sum(slPipeline.map((r) => r.value));
  const att = Math.round(mean(slQuota.map((r) => r.value)));
  const slKpis = [
    { label: "Bookings, last 12 months", value: `$${r1(last12 / 1000)}M`, delta: `${signed(100 * (last12 / prior12 - 1), 1, "%")} vs prior 12 months`, deltaDir: last12 >= prior12 ? "up" : "down" },
    { label: "Team quota attainment (YTD)", value: `${att}%`, delta: `${slQuota.filter((r) => r.value >= 100).length} of ${REPS.length} reps at or above 100%`, deltaDir: att >= 100 ? "up" : "down" },
    { label: "Open pipeline", value: `$${r1(pipe)}M`, delta: "across 5 stages · weighted $3.4M" },
    { label: "Pipeline coverage", value: `${r1(pipe / 2.9)}×`, delta: "of remaining-year quota ($2.9M) · target 3×", deltaDir: pipe / 2.9 >= 3 ? "up" : "down" }
  ];
  return { datasets: { slKpis, slBookings, slQuota, slPipeline, slDeals }, facts: {} };
}

// ── labels for the dataset picker / SQL tab ───────────────────────────────
export const LABELS = {
  cocKpis: "Meridian CoC — SPM headline KPIs", cocDaysByHousehold: "Meridian CoC — median days homeless by household type, FY2022–26", cocExitDestinations: "Meridian CoC — exits by destination, FY2026", cocLothStays: "Meridian CoC — person-stays (length of time homeless), FY2026", cocReturnsTiming: "Meridian CoC — returns to homelessness by timing", cocSpmTable: "Meridian CoC — System Performance Measures, FY2025 vs FY2026", cocEquity: "Meridian CoC — outcomes by race/ethnicity", cocMonthlyFlow: "Meridian CoC — monthly inflow/outflow/active",
  flowInOut: "Meridian CoC — monthly inflow vs outflow", flowActive: "Meridian CoC — actively homeless by month", flowByGroup: "Meridian CoC — actively homeless by household group", flowKpis: "Meridian CoC — system flow KPIs",
  bhKpis: "Meridian CCBHC — headline KPIs", bhGapToBenchmark: "Meridian CCBHC — gap to benchmark by measure", bhSiteTrends: "Meridian CCBHC — DEP-REM-6 by site and quarter", bhHeatmap: "Meridian CCBHC — measure × site rates", bhPhqBands: "Meridian CCBHC — PHQ-9 outcome bands by site", bhMeasureTable: "Meridian CCBHC — measure table (num/den/rate)",
  udsKpis: "Meridian Health Center — UDS headline KPIs", udsCqmTrend: "Meridian Health Center — headline CQMs by year", udsVsNational: "Meridian Health Center — CQM gap vs national", udsPayerMix: "Meridian Health Center — payer mix by year", udsServiceLines: "Meridian Health Center — visits by service line", udsCqmTable: "Meridian Health Center — CQM table", udsQuarterly: "Meridian Health Center — 2026 quarterly estimates", udsCqm: "Meridian Health Center — all CQMs × years",
  odKpis: "Meridian overdose — headline KPIs", odRollingRate: "Meridian overdose — 12-month rolling death rate", odEdVisits: "Meridian overdose — monthly nonfatal ED visits", odStateRates: "Overdose death rates by state (synthetic)", odBySubstance: "Meridian overdose — rate by substance and year", odMonthly: "Meridian overdose — monthly deaths and ED visits",
  chKpis: "Meridian community health — headline KPIs", chStateRates: "Uninsured adults by state (synthetic)", chFactors: "Meridian community health — factors vs state and U.S.", chScatter: "States — uninsured vs premature death (synthetic)", chTable: "States — uninsured and premature death table",
  poKpis: "Meridian programs — funder KPIs", poEnrollments: "Meridian programs — enrolments by quarter", poAttainment: "Meridian programs — outcome attainment by program/site", poPrePost: "Meridian programs — pre→post change by cohort", poDemographics: "Meridian programs — participants vs service area",
  cs311Kpis: "Meridian 311 — headline KPIs", cs311Daily: "Meridian 311 — daily opened vs closed", cs311Types: "Meridian 311 — volume by request type", cs311CloseVsTarget: "Meridian 311 — median close time as % of target", cs311Heatmap: "Meridian 311 — requests by weekday × hour", cs311District: "Meridian 311 — median days to close by district", cs311Table: "Meridian 311 — request type table",
  scKpis: "Meridian scorecard — status counts", scTable: "Meridian scorecard — measures vs targets", scPctTarget: "Meridian scorecard — % of target by measure", scPerspectiveTrend: "Meridian scorecard — trend by perspective",
  exKpis: "Executive — KPIs by function", exRevenue: "Executive — revenue vs prior year", exBudget: "Executive — actual vs budget by function", exByFunction: "Executive — actual as % of budget",
  starterKpis: "Meridian community services — starter KPIs",
  slKpis: "Sales — KPIs", slBookings: "Sales — bookings vs prior year", slQuota: "Sales — quota attainment by rep", slPipeline: "Sales — pipeline by stage", slDeals: "Sales — deal size vs cycle length",
  bhSiteTrendLines: "Meridian CCBHC — DEP-REM-6 by site and quarter (one line each)", odBySubstanceTrend: "Meridian overdose — rate by substance (one line each)", cocSpmBriefTable: "Meridian CoC — SPM brief table (FY2025 vs FY2026)", bhMeasureBriefTable: "Meridian CCBHC — measure brief table", cs311BriefTable: "Meridian 311 — brief table by request type", scPerspectiveTrendLines: "Meridian scorecard — average % of target by perspective (one line each)", chFactorsCompared: "Meridian community health — factors vs state and U.S. (grouped)"
};

// Starter dashboard: Meridian community services at a glance, composed from
// the 311 and CoC families (the same numbers, re-cut into one KPI row).
function buildStarter(coc, cs) {
  const starterKpis = [
    { label: "311 requests closed within target", value: `${cs.facts.onTimeAll}%`, delta: "last 150 days · goal 80% · higher is better", deltaDir: cs.facts.onTimeAll >= 80 ? "up" : "down" },
    { label: "311 median days to close (administrative)", value: `${cs.facts.medAll} days`, delta: `mean ${cs.facts.meanAll} days · lower is better` },
    { label: "People actively homeless (Sep 2026)", value: commas(coc.facts.latest), delta: `${coc.facts.last3net > 0 ? "▲" : "▼"} ${Math.abs(Math.round(coc.facts.last3net))}/month over the last 3 months · lower is better`, deltaDir: coc.facts.last3net > 0 ? "up" : "down", invert: true },
    { label: "Exits to permanent housing, FY2026", value: `${coc.facts.phPct26}%`, delta: `${signed(coc.facts.phPct26 - coc.facts.phPct25, 1, " pts")} vs FY2025 · CoC goal 45%`, deltaDir: coc.facts.phPct26 >= coc.facts.phPct25 ? "up" : "down" }
  ];
  return { datasets: { starterKpis }, facts: {} };
}

export function generate() {
  const coc = buildCoc(), bh = buildBh(), uds = buildUds(), od = buildOverdose(), ch = buildCommunity(), po = buildPrograms(), cs = buildCs311();
  const sc = buildScorecard(coc, bh, uds, cs), ex = buildExecutive(), sl = buildSales(), st = buildStarter(coc, cs);
  const families = { coc, bh, uds, overdose: od, community: ch, programs: po, cs311: cs, scorecard: sc, executive: ex, sales: sl, starter: st };
  return { families, facts: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, v.facts])) };
}

// ── plausibility anchors (hard acceptance checks) ─────────────────────────
export function checkAnchors({ families }) {
  const f = (k) => families[k].facts;
  const results = [];
  const check = (name, value, ok, detail = "") => results.push({ name, value, ok: Boolean(ok), detail });
  check("PHQ-9 / DEP-REM-6 remission 10–25%", f("bh").remission, f("bh").remission >= 10 && f("bh").remission <= 25);
  const ret24pct = (100 * f("coc").ret24) / f("coc").cohort26;
  check("Returns to homelessness (24 mo) 8–18%", r1(ret24pct), ret24pct >= 8 && ret24pct <= 18);
  check("Most returns inside 6 months", `${f("coc").ret6} of ${f("coc").ret24}`, f("coc").ret6 > f("coc").ret24 / 2);
  check("HTN control 60–72%", f("uds").htn, f("uds").htn >= 60 && f("uds").htn <= 72);
  check("Diabetes poor control present, inverse-labelled", f("uds").dmPoor, f("uds").dmPoor > 0 && families.uds.datasets.udsVsNational.some((r) => /inverse/.test(r.measure) && /inv\./.test(r.label)));
  check("311 top-3 request types = 40–55% of volume", f("cs311").top3, f("cs311").top3 >= 40 && f("cs311").top3 <= 55);
  const badRatio = f("cs311").meanToMedian.filter(([, r]) => r < 2 || r > 3);
  check("311 days-to-close mean = 2–3× median per type", f("cs311").meanToMedian.map(([l, r]) => `${l.split(" ")[0]} ${r}`).join(", "), badRatio.length === 0, badRatio.length ? `out of range: ${badRatio.map(([l]) => l).join(", ")}` : "");
  check("LOTH median ~60–90 days", f("coc").med26, f("coc").med26 >= 60 && f("coc").med26 <= 90);
  check("LOTH mean ~140–180 days", f("coc").mean26, f("coc").mean26 >= 140 && f("coc").mean26 <= 180);
  check("300–800 person-stays", f("coc").staysFY26, f("coc").staysFY26 >= 300 && f("coc").staysFY26 <= 800);
  check("State overdose rates spread ~6–7×", f("overdose").stateSpread, f("overdose").stateSpread >= 6 && f("overdose").stateSpread <= 7);
  check("State uninsured rates spread ~6–7×", f("community").spread, f("community").spread >= 6 && f("community").spread <= 7);
  check("County overdose deaths 3–25 per month", f("overdose").deathsRange.join("–"), f("overdose").deathsRange[0] >= 3 && f("overdose").deathsRange[1] <= 25);
  const rr = f("bh").remissionRange; const bhSpread = Math.max(...rr) - Math.min(...rr);
  check("BH site outcome spread 10–25 pts (DEP-REM-6 is a low-rate measure: checked on FUH-30)", (() => { const x = f("bh").fuh30Sites; return r1(Math.max(...x) - Math.min(...x)); })(), (() => { const x = f("bh").fuh30Sites; const d = Math.max(...x) - Math.min(...x); return d >= 10 && d <= 25; })(), `DEP-REM-6 site range ${rr.join("–")}`);
  check("Program site/programme outcome spread 10–25 pts", f("programs").spread, f("programs").spread >= 10 && f("programs").spread <= 25);
  const types = Object.keys(f("coc").typeMedians26);
  check("CoC mix-shift: every household type improves ≥5%, overall median moves <3%", `families ${f("coc").famShare25}% → ${f("coc").famShare26}% of stays; overall ${f("coc").med25} → ${f("coc").med26}; ${types.map((k) => `${k} ${f("coc").typeMedians25[k]}→${f("coc").typeMedians26[k]}`).join(", ")}`,
    types.every((k) => f("coc").typeMedians26[k] <= 0.95 * f("coc").typeMedians25[k]) && Math.abs(f("coc").med26 - f("coc").med25) < 0.03 * f("coc").med25);
  return results;
}

// A Windows checkout with core.autocrlf may hold CRLF copies of the LF files
// this script writes; byte identity is checked on content, not line endings.
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

// ── serialization: one row per line, stable key order ─────────────────────
function serialize(obj) {
  const keys = Object.keys(obj);
  const parts = keys.map((k) => `  ${JSON.stringify(k)}: [\n${obj[k].map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`);
  return `{\n${parts.join(",\n")}\n}\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const OUT = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(ROOT, "src", "data", "meridian");
  const checkOnly = args.includes("--check");
  const result = generate();
  const anchors = checkAnchors(result);
  for (const a of anchors) console.log(`${a.ok ? "PASS" : "FAIL"}  ${a.name}: ${a.value}${a.detail ? `  (${a.detail})` : ""}`);
  const failed = anchors.filter((a) => !a.ok);
  let drift = 0;
  if (!checkOnly) mkdirSync(OUT, { recursive: true });
  for (const [name, fam] of Object.entries(result.families)) {
    const text = serialize(fam.datasets);
    const file = join(OUT, `${name}.json`);
    if (checkOnly) {
      if (!existsSync(file) || normalizeEol(readFileSync(file, "utf8")) !== text) { console.log(`DRIFT  ${file} differs from a fresh generation`); drift++; }
    } else writeFileSync(file, text);
  }
  const labelsText = `${JSON.stringify(LABELS, null, 2)}
`;
  const labelsFile = join(OUT, "labels.json");
  if (checkOnly) { if (!existsSync(labelsFile) || normalizeEol(readFileSync(labelsFile, "utf8")) !== labelsText) { console.log(`DRIFT  ${labelsFile} differs from a fresh generation`); drift++; } }
  else writeFileSync(labelsFile, labelsText);
  const total = Object.values(result.families).reduce((n, fam) => n + Object.keys(fam.datasets).length, 0);
  console.log(`${checkOnly ? "Checked" : "Wrote"} ${Object.keys(result.families).length} family files, ${total} datasets (seed ${SEED}, as of ${AS_OF}).`);
  if (failed.length || drift) { console.log(`${failed.length} anchor failure(s), ${drift} drifted file(s).`); process.exit(1); }
}
