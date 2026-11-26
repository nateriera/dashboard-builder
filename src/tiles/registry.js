import { facetGeometry } from './geometry.js';
import { renderData } from "../charts/integrity.js";
import { chartData } from "../ui/chartData.js";
// Tile registry: the catalog of chart types the composer can place on the grid.
//
// Each entry describes one tile type:
//   type           - stable key used in layout JSON
//   label          - human-readable name shown in the palette
//   description    - one-line palette subtitle
//   datasets       - dataset keys this tile can render (see DATASETS below)
//   defaultDataset - dataset selected for a fresh tile
//   defaultSize    - GridStack {w, h} for a fresh tile (12-column grid)
//   defaultTitle   - initial tile title (editable in the tile toolbar)
//   controls       - optional extra toolbar controls, e.g. checkboxes
//   render(el, {data, options}) - mounts the chart into el.
//     el is the .tile-chart container; measure el.clientWidth and pass it as
//     the chart width so tiles re-render crisply at their grid size.
//     options = {title, source, tileOptions} where tileOptions holds the
//     per-tile control values (e.g. {trend: true}).

import {
  barChart,
  columnChart,
  lineChart,
  scatterChart,
  dotChart,
  donutChart,
  choropleth,
  smallMultiples,
  stackedBarChart,
  stackedColumnChart,
  histogramChart,
  boxplotChart,
  areaChart,
  heatmapChart,
  treemapChart,
  dataTableChart,
  textAnnotation,
  kpiRow,
  card
} from "../charts/charts.js";

import categorical from "../data/categorical.json";
import timeseries from "../data/timeseries.json";
import scatter from "../data/scatter.json";
import kpis from "../data/kpis.json";
import states from "../data/states.json";
import facets from "../data/facets.json";
import stacked from "../data/stacked.json";
import boxdata from "../data/boxdata.json";
import heatmap from "../data/heatmap.json";
import treemap from "../data/treemap.json";
import usStates from "../data/us-states-10m.json";
// Meridian County: one fictitious jurisdiction's synthetic data universe,
// written by scripts/generate-sample-data.mjs (seeded, deterministic). Each
// family file holds several tile-shaped datasets keyed by dataset id.
import meridianCoc from "../data/meridian/coc.json";
import meridianBh from "../data/meridian/bh.json";
import meridianUds from "../data/meridian/uds.json";
import meridianOverdose from "../data/meridian/overdose.json";
import meridianCommunity from "../data/meridian/community.json";
import meridianPrograms from "../data/meridian/programs.json";
import meridianCs311 from "../data/meridian/cs311.json";
import meridianScorecard from "../data/meridian/scorecard.json";
import meridianExecutive from "../data/meridian/executive.json";
import meridianSales from "../data/meridian/sales.json";
import meridianStarter from "../data/meridian/starter.json";
import meridianLabels from "../data/meridian/labels.json";

// ── CoC edition (Stage 1b): Meridian HMIS microdata ────────────────────
// A seeded, deterministic generator for HMIS-shaped synthetic microdata:
// persons, enrollments and income assessments for the fictitious Meridian
// County CoC, FY2024–FY2026 (Oct 1, 2023 – Sep 30, 2026). Enrollments active
// on Oct 1, 2023 are included with their earlier entry dates, as an HMIS
// extract would include them. Synthetic people only.
//
// The simulation draws household spells (outreach → shelter / transitional
// housing → exit, with rapid rehousing or PSH after some housing exits, and
// returns after some exits), then makes a few targeted adjustments so the
// shipped CoC story stays true of the data: by-race exit-to-housing and
// return rates, 64 of 121 returns within six months, ~4% unknown
// destinations. Adjustments only touch single-person households whose
// enrollment is their last, so no other record depends on what changes.
const HMIS_DAY0 = Date.UTC(2023, 9, 1);
const HMIS_FY = { FY2024: [0, 366], FY2025: [366, 731], FY2026: [731, 1096] }; // [start, end) day index
const END = 1095; // Sep 30, 2026: last observed day
const hmisDate = (d) => new Date(HMIS_DAY0 + d * 864e5).toISOString().slice(0, 10);
const DATE_CACHE = new Map();

const DESTINATIONS = {
  phSub: "PH, subsidized", phUnsub: "PH, unsubsidized", phFamily: "PH, with family",
  tempFamily: "Temp, with family", shelter: "Emergency shelter", street: "Place not meant for habitation",
  institution: "Institutional", motel: "Motel, no voucher", deceased: "Deceased",
  dk: "DK / refused", missing: "Not collected"
};
const PH = new Set([DESTINATIONS.phSub, DESTINATIONS.phUnsub, DESTINATIONS.phFamily]);
const RACES = [
  ["Black, African American, or African", "Black"], ["White", "White"],
  ["American Indian, Alaska Native, or Indigenous", "AI/AN"], ["Asian or Asian American", "Asian"],
  ["Native Hawaiian or Pacific Islander", "NH/PI"], ["Multiracial", "Multiracial"],
  ["Client doesn't know / prefers not to answer", "Unknown"]
];
const PROJECTS = {
  SO: ["Meridian Street Outreach"], ES: ["Harbor Street Emergency Shelter", "Northgate Family Shelter", "Riverside Night Shelter"],
  SH: ["Cedar Safe Haven"], TH: ["Bridgeway Transitional Housing", "Elm Youth Transitional Living"],
  RRH: ["Meridian Rapid Rehousing"], PSH: ["Meridian Supportive Housing", "Eastside Scattered-Site PSH"]
};

function mulberry32(a) {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generateMeridianHmis(seed = 20261125) {
  const rnd = mulberry32(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) if ((r -= w) < 0) return v; return pairs.at(-1)[0]; };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (median, sigma) => Math.max(1, Math.round(median * Math.exp(sigma * normal())));
  const fyOf = (d) => (d < 366 ? "FY2024" : d < 731 ? "FY2025" : "FY2026");

  const persons = [], households = [], enrollments = [];
  let pid = 0, hid = 0, eid = 0;
  const pad = (n) => String(n).padStart(5, "0");

  // Household types and their mix of new spells by fiscal year (FY2023 is warm-up).
  const HH = {
    "Adults only": { spells: { FY2023: 1350, FY2024: 1380, FY2025: 1600, FY2026: 1330 }, so: 0.38, th: 0.07, sh: 0.05 },
    "Families": { spells: { FY2023: 45, FY2024: 50, FY2025: 66, FY2026: 258 }, so: 0.03, th: 0.18, sh: 0 },
    "Youth 18–24": { spells: { FY2023: 230, FY2024: 230, FY2025: 270, FY2026: 240 }, so: 0.3, th: 0.3, sh: 0 },
    "Veterans": { spells: { FY2023: 190, FY2024: 190, FY2025: 210, FY2026: 185 }, so: 0.3, th: 0.15, sh: 0.06 }
  };
  // Median shelter nights by household type and fiscal year of entry.
  const LOS = {
    "Adults only": { FY2023: 38, FY2024: 37, FY2025: 36, FY2026: 31 },
    "Families": { FY2023: 84, FY2024: 82, FY2025: 80, FY2026: 64 },
    "Youth 18–24": { FY2023: 33, FY2024: 32, FY2025: 31, FY2026: 22 },
    "Veterans": { FY2023: 32, FY2024: 31, FY2025: 30, FY2026: 26 }
  };
  // Probability a shelter exit goes to permanent housing, by equity group.
  const PH_RATE = { Black: 0.3, White: 0.45, Hispanic: 0.4, Multiracial: 0.37, "AI/AN": 0.37, Asian: 0.42, "NH/PI": 0.38, Unknown: 0.3 };
  const RETURN_RATE = { Black: 0.17, White: 0.1, Hispanic: 0.14, Multiracial: 0.13, "AI/AN": 0.1, Asian: 0.1, "NH/PI": 0.12, Unknown: 0.12 };

  function newHousehold(type) {
    const id = "H" + pad(++hid);
    const raceIdx = weighted([[0, 44], [1, 30], [2, 4], [3, 2], [4, 1.2], [5, 6], [6, 1.5]]);
    const hispanic = rnd() < (raceIdx === 1 ? 0.3 : 0.06);
    const size = type === "Families" ? weighted([[2, 30], [3, 38], [4, 22], [5, 10]]) : 1;
    const disabled = rnd() < (type === "Families" ? 0.25 : 0.5);
    const members = [];
    for (let i = 0; i < size; i++) {
      const adult = i === 0 || (i === 1 && rnd() < 0.35);
      const age = !adult ? "Under 18" : type === "Youth 18–24" ? "18–24" : type === "Veterans" ? weighted([["35–44", 15], ["45–54", 25], ["55–64", 35], ["65+", 25]]) : type === "Families" ? weighted([["18–24", 20], ["25–34", 45], ["35–44", 30], ["45–54", 5]]) : weighted([["18–24", 6], ["25–34", 22], ["35–44", 24], ["45–54", 24], ["55–64", 18], ["65+", 6]]);
      const p = {
        person_id: "P" + pad(++pid), age_band: age, race: RACES[raceIdx][0],
        ethnicity: raceIdx === 6 && rnd() < 0.5 ? "Client doesn't know / prefers not to answer" : hispanic ? "Hispanic/Latina/e/o" : "Not Hispanic/Latina/e/o",
        veteran_status: type === "Veterans" && i === 0 ? "Yes" : "No",
        disabling_condition: adult ? (i === 0 && disabled ? "Yes" : rnd() < 0.03 ? "Client doesn't know / prefers not to answer" : "No") : "No",
        household_type: type
      };
      persons.push(p); members.push(p);
    }
    const group = members[0].ethnicity === "Hispanic/Latina/e/o" ? "Hispanic" : RACES[raceIdx][1];
    const h = { id, type, members, group, disabled };
    households.push(h);
    return h;
  }

  function enroll(h, type, entry, exit, destination) {
    const project = type === "ES" && h.type === "Families" ? PROJECTS.ES[1] : type === "ES" ? pick([PROJECTS.ES[0], PROJECTS.ES[2]]) : type === "TH" ? PROJECTS.TH[h.type === "Youth 18–24" ? 1 : 0] : pick(PROJECTS[type]);
    const open = exit > END;
    for (const p of h.members) {
      enrollments.push({
        enrollment_id: "E" + String(++eid).padStart(6, "0"), person_id: p.person_id, household_id: h.id,
        project_name: project, project_type: type, entry_date: entry, exit_date: open ? null : exit,
        destination: open ? null : destination, _h: h
      });
    }
    return open;
  }

  function shelterDestination(h, fy) {
    if (rnd() < PH_RATE[h.group] * ({ FY2024: 0.93, FY2025: 1, FY2026: 1.03 })[fy]) return weighted([[DESTINATIONS.phSub, 47], [DESTINATIONS.phUnsub, 31], [DESTINATIONS.phFamily, 22]]);
    return weighted([[DESTINATIONS.tempFamily, 36], [DESTINATIONS.shelter, 8], [DESTINATIONS.street, 22], [DESTINATIONS.institution, 15], [DESTINATIONS.motel, 10], [DESTINATIONS.deceased, 1.2], [DESTINATIONS.dk, 2.5], [DESTINATIONS.missing, 4.5]]);
  }

  // One spell: optional outreach, a shelter / TH stay, then what follows.
  function spell(h, start, depth) {
    if (start > END) return;
    const cfg = HH[h.type];
    let d = start;
    if (depth === 0 && rnd() < cfg.so) {
      const len = logn(45, 0.9);
      const toShelter = rnd() < 0.62;
      const dest = toShelter ? DESTINATIONS.shelter : weighted([[DESTINATIONS.street, 40], [DESTINATIONS.tempFamily, 18], [DESTINATIONS.phFamily, 6], [DESTINATIONS.phUnsub, 4], [DESTINATIONS.institution, 12], [DESTINATIONS.motel, 6], [DESTINATIONS.dk, 6], [DESTINATIONS.missing, 8]]);
      if (enroll(h, "SO", d, d + len, dest) || !toShelter) return;
      d += len;
    }
    const type = rnd() < cfg.th ? "TH" : rnd() < cfg.sh ? "SH" : "ES";
    const fy = d < 0 ? "FY2023" : fyOf(d);
    const median = LOS[h.type][fy] * (type === "TH" ? 3.2 : type === "SH" ? 2.2 : 1);
    const len = logn(median, type === "TH" ? 0.6 : 1.05);
    const dest = shelterDestination(h, fyOf(Math.max(0, d + len)));
    if (enroll(h, type, d, d + len, dest)) return;
    d += len;
    after(h, d, dest, depth);
  }

  function after(h, d, dest, depth) {
    if (PH.has(dest)) {
      // Housing exits: some move into RRH or PSH the same day.
      if (dest === DESTINATIONS.phSub && rnd() < 0.5) {
        const psh = h.disabled && h.type !== "Families" && rnd() < 0.3;
        const len = psh ? logn(1400, 0.8) : logn(260, 0.35);
        const out = psh ? weighted([[DESTINATIONS.phSub, 50], [DESTINATIONS.phFamily, 20], [DESTINATIONS.institution, 10], [DESTINATIONS.deceased, 12], [DESTINATIONS.street, 8]]) : rnd() < 0.78 ? weighted([[DESTINATIONS.phUnsub, 60], [DESTINATIONS.phSub, 30], [DESTINATIONS.phFamily, 10]]) : weighted([[DESTINATIONS.tempFamily, 50], [DESTINATIONS.shelter, 20], [DESTINATIONS.dk, 15], [DESTINATIONS.missing, 15]]);
        if (enroll(h, psh ? "PSH" : "RRH", d, d + len, out)) return;
        d += len; dest = out;
        if (!PH.has(out)) { if (out !== DESTINATIONS.deceased && depth < 3 && rnd() < 0.4) spell(h, d + logn(60, 0.8), depth + 1); return; }
      }
      if (depth < 3 && rnd() < RETURN_RATE[h.group] * 1.15) spell(h, d + Math.min(729, logn(150, 1.1)), depth + 1);
    } else if (dest !== DESTINATIONS.deceased && depth < 3 && rnd() < 0.33) {
      spell(h, d + logn(90, 0.9), depth + 1);
    }
  }

  // PSH tenants housed before the data span.
  for (let i = 0; i < 520; i++) {
    const h = newHousehold(weighted([["Adults only", 70], ["Veterans", 20], ["Families", 10]]));
    h.disabled = true;
    const entry = -1 - Math.floor(rnd() * 2400), len = logn(1900, 0.7);
    if (entry + len < 0) { i--; continue; }
    enroll(h, "PSH", entry, entry + len, weighted([[DESTINATIONS.phSub, 50], [DESTINATIONS.phFamily, 20], [DESTINATIONS.institution, 10], [DESTINATIONS.deceased, 12], [DESTINATIONS.street, 8]]));
  }
  // New spells, FY2023 (warm-up) to FY2026.
  for (const [fy, [s, e]] of [["FY2023", [-365, 0]], ...Object.entries(HMIS_FY)]) {
    for (const [type, cfg] of Object.entries(HH)) {
      for (let i = 0; i < cfg.spells[fy]; i++) spell(newHousehold(type), s + Math.floor(rnd() * (e - s)), 0);
    }
  }

  // Keep what an FY2024–FY2026 extract holds: enrollments active on or after Oct 1, 2023.
  const removed = new Set();
  const rows = enrollments.filter((r) => r.exit_date == null || r.exit_date >= 0);

  // ── Targeted adjustments ───────────────────────────────────────────────
  const byPerson = new Map();
  for (const r of rows) (byPerson.get(r.person_id) || byPerson.set(r.person_id, []).get(r.person_id)).push(r);
  for (const l of byPerson.values()) l.sort((a, b) => a.entry_date - b.entry_date);
  const single = (r) => r._h.members.length === 1;
  const lastOf = (r) => byPerson.get(r.person_id).at(-1) === r;

  // A count c of n that displays as `pct` at one decimal, or -1 if none does.
  const fit = (n, pct) => { for (const c of [Math.round((pct * n) / 100), Math.round((pct * n) / 100) - 1, Math.round((pct * n) / 100) + 1]) if (c >= 0 && ((100 * c) / n).toFixed(1) === pct.toFixed(1)) return c; return -1; };
  const forget = (r) => { removed.add(r); const list = byPerson.get(r.person_id).filter((n) => n !== r); if (list.length) byPerson.set(r.person_id, list); else byPerson.delete(r.person_id); };

  // Returns (M2): the FY2024 housing-exit cohort, by group, then timing.
  const firstReturnGap = (r) => {
    for (const n of byPerson.get(r.person_id)) {
      if (n.entry_date <= r.exit_date) continue;
      const gap = n.entry_date - r.exit_date;
      if (gap > 730) break;
      if ((n.project_type === "RRH" || n.project_type === "PSH") && gap <= 14) continue;
      return gap;
    }
    return null;
  };
  // The cohort: each person's first housing exit in FY2024. Later edits never change
  // which exit that is; `forget` removes a whole person, so the list is built once.
  let cohort = [];
  for (const list of byPerson.values()) {
    const r = list.find((x) => x.exit_date != null && x.exit_date < 366 && PH.has(x.destination));
    if (r) cohort.push(r);
  }
  const cohortOf = (g) => (g ? cohort.filter((r) => r._h.group === g) : cohort);
  const dropAfter = (r) => { const list = byPerson.get(r.person_id); for (const n of list) if (n.entry_date > r.exit_date) removed.add(n); byPerson.set(r.person_id, list.filter((n) => n.entry_date <= r.exit_date)); };
  const addReturn = (r, gap) => {
    const entry = r.exit_date + gap, len = logn(40, 0.9), open = entry + len > END;
    const n = { ...r, enrollment_id: "E" + String(++eid).padStart(6, "0"), project_name: PROJECTS.ES[0], project_type: "ES", entry_date: entry, exit_date: open ? null : entry + len, destination: open ? null : pick([DESTINATIONS.tempFamily, DESTINATIONS.street, DESTINATIONS.motel, DESTINATIONS.institution]) };
    rows.push(n); byPerson.get(r.person_id).push(n);
  };
  // Adjusted: single-person households whose later records are only return spells.
  const adjustable = (r) => single(r) && byPerson.get(r.person_id).every((n) => n.entry_date <= r.exit_date || !["RRH", "PSH"].includes(n.project_type) || n.entry_date > r.exit_date + 14);
  const quietOf = (g) => cohortOf(g).filter((r) => firstReturnGap(r) == null && adjustable(r) && lastOf(r) && byPerson.get(r.person_id).length === 1);
  {
    const want = {};
    for (const [g, pct] of [["Black", 17.2], ["White", 10.2]]) {
      // Drop quiet single-record cohort members until the rate can display exactly.
      while (fit(cohortOf(g).length, pct) < 0) { const r = quietOf(g)[0]; forget(r); cohort = cohort.filter((x) => x !== r); }
      want[g] = fit(cohortOf(g).length, pct);
    }
    const others = [...new Set(cohortOf().map((r) => r._h.group))].filter((g) => !(g in want)).sort();
    const otherN = others.map((g) => cohortOf(g).length), totalOther = otherN.reduce((a, b) => a + b, 0);
    const rest = 121 - want.Black - want.White;
    let assigned = 0;
    others.forEach((g, i) => { want[g] = i === others.length - 1 ? rest - assigned : Math.round((rest * otherN[i]) / totalOther); assigned += want[g]; });
    for (const g of Object.keys(want)) {
      const returners = cohortOf(g).filter((r) => firstReturnGap(r) != null);
      for (const r of returners.filter(adjustable).slice(0, Math.max(0, returners.length - want[g]))) dropAfter(r);
      const have = cohortOf(g).filter((r) => firstReturnGap(r) != null).length;
      for (const r of quietOf(g).slice(0, Math.max(0, want[g] - have))) addReturn(r, Math.min(729, logn(150, 1.1)));
    }
    // Timing: 64 of the 121 returns within six months (180 days).
    const ret = cohortOf().filter((r) => firstReturnGap(r) != null);
    const early = ret.filter((r) => firstReturnGap(r) <= 180);
    const move = early.length - 64;
    const pool = (move > 0 ? early : ret.filter((r) => firstReturnGap(r) > 180)).filter(adjustable);
    for (const r of pool.slice(0, Math.abs(move))) { dropAfter(r); addReturn(r, move > 0 ? 181 + Math.floor(rnd() * 500) : 1 + Math.floor(rnd() * 180)); }
  }

  // Exits to housing (M7b.1), FY2026, by group; ~4% unknown destinations.
  {
    const [s, e] = HMIS_FY.FY2026;
    // Each leaver's last FY2026 exit; destination edits never change who leaves.
    let left = [];
    for (const list of byPerson.values()) {
      const pool = list.filter((r) => ["ES", "SH", "TH", "RRH"].includes(r.project_type));
      if (pool.some((r) => r.entry_date < e && (r.exit_date == null || r.exit_date >= e))) continue;
      const exits = pool.filter((r) => r.exit_date != null && r.exit_date >= s && r.exit_date < e);
      if (exits.length) left.push(exits.at(-1));
    }
    const leavers = (g) => (g ? left.filter((r) => r._h.group === g) : left);
    const free = (r) => single(r) && lastOf(r);
    for (const [g, pct] of [["Black", 32.5], ["White", 47.0]]) {
      while (fit(leavers(g).length, pct) < 0) { const r = leavers(g).find((x) => free(x) && byPerson.get(x.person_id).length === 1); forget(r); left = left.filter((x) => x !== r); }
      const members = leavers(g), want = fit(members.length, pct);
      const housed = members.filter((r) => PH.has(r.destination));
      const diff = housed.length - want;
      const pool = (diff > 0 ? housed : members.filter((r) => !PH.has(r.destination) && r.destination !== DESTINATIONS.deceased)).filter(free);
      for (const r of pool.slice(0, Math.abs(diff))) r.destination = diff > 0 ? DESTINATIONS.tempFamily : DESTINATIONS.phUnsub;
    }
    const all = leavers();
    const unknown = (r) => r.destination === DESTINATIONS.dk || r.destination === DESTINATIONS.missing;
    const have = all.filter(unknown), diff = have.length - Math.round(0.042 * all.length);
    const pool = (diff > 0 ? have : all.filter((r) => r.destination === DESTINATIONS.tempFamily)).filter(free);
    for (const r of pool.slice(0, Math.abs(diff))) r.destination = diff > 0 ? DESTINATIONS.tempFamily : DESTINATIONS.missing;
  }

  // ── Income assessments: adults in CoC-funded projects (TH, RRH, PSH) ────
  const income = [];
  const adults = new Map(persons.map((p) => [p.person_id, p.age_band !== "Under 18"]));
  let aid = 0;
  for (const r of rows) {
    if (removed.has(r)) continue;
    if (!["TH", "RRH", "PSH"].includes(r.project_type) || !adults.get(r.person_id)) continue;
    let earned = rnd() < 0.22 ? Math.round(400 + rnd() * 1400) : 0;
    let other = rnd() < 0.45 ? Math.round(300 + rnd() * 900) : 0;
    const step = (point, day) => {
      if (day < 0 && point !== "entry") return;
      income.push({ assessment_id: "A" + String(++aid).padStart(6, "0"), enrollment_id: r.enrollment_id, person_id: r.person_id, assessment_point: point, assessment_date: day, earned_income: earned, non_employment_cash_income: other, total_income: earned + other });
    };
    step("entry", r.entry_date);
    const grow = () => {
      if (rnd() < (r.project_type === "PSH" ? 0.05 : 0.16)) earned = earned ? Math.round(earned * (1.1 + rnd() * 0.4)) : Math.round(500 + rnd() * 1300);
      else if (earned && rnd() < 0.1) earned = 0;
      if (rnd() < (r.project_type === "PSH" ? 0.07 : 0.1)) other = other ? Math.round(other * (1.03 + rnd() * 0.2)) : Math.round(400 + rnd() * 700);
    };
    for (let a = r.entry_date + 365; a <= (r.exit_date ?? END); a += 365) { grow(); step("update", a); }
    if (r.exit_date != null) { grow(); step("exit", r.exit_date); }
  }

  const iso = (d) => (d == null ? null : DATE_CACHE.get(d) ?? DATE_CACHE.set(d, hmisDate(d)).get(d));
  return {
    persons: persons.filter((p) => byPerson.has(p.person_id)),
    enrollments: rows.filter((r) => !removed.has(r)).sort((a, b) => a.entry_date - b.entry_date || (a.enrollment_id < b.enrollment_id ? -1 : 1))
      .map(({ _h, ...r }) => ({ ...r, entry_date: iso(r.entry_date), exit_date: iso(r.exit_date) })),
    income_assessments: income.filter((a) => a.assessment_date >= 0 || a.assessment_point === "entry").map((a) => ({ ...a, assessment_date: iso(a.assessment_date) }))
  };
}

// Packet summaries, generated from the microdata (never typed by hand).
// Rules, all person-level as the SPM counts people:
//  M1    nights in ES/SH (and ES/SH/TH) stays active in the fiscal year,
//        counted from entry to exit or year end, summed per person.
//  M2    people whose first housing exit fell in FY2024; a return is any
//        later entry within 730 days (a PH entry within 14 days is the same
//        housing move, not a return). Within 6 months = 180 days or fewer.
//  M3.1  people in ES/SH/TH on the PIT night, plus people with an open
//        outreach enrollment that night (an HMIS-based unsheltered count).
//  M3.2  people with an ES/SH/TH stay active in the year.
//  M4    adults in TH/RRH/PSH (CoC Program-funded in Meridian): stayers
//        compare entry with their latest annual update in the year; leavers
//        compare entry with exit.
//  M5    people whose first ES/SH/TH/PH entry in the year has no ES/SH/TH/PH
//        record in the 730 days before it.
//  M7a   outreach leavers (deceased excluded) reaching anywhere but the
//        street or an unknown destination.
//  M7b.1 ES/SH/TH/RRH leavers (no stay still open at year end), by their
//        last exit in the year, to a permanent destination.
//  M7b.2 PSH participants who stayed or left for permanent housing
//        (deceased excluded).
const SUM_FY = { FY2025: ["2024-10-01", "2025-10-01", "2025-01-29"], FY2026: ["2025-10-01", "2026-10-01", "2026-01-28"] };
const HOUSED = ["PH, subsidized", "PH, unsubsidized", "PH, with family"];
const HOUSEHOLDS = ["Adults only", "Families", "Youth 18–24", "Veterans"];
const EQUITY = ["Black", "White", "Hispanic", "Multiracial", "AI/AN", "Asian", "NH/PI"];
const SHORT_RACE = { "Black, African American, or African": "Black", White: "White", "American Indian, Alaska Native, or Indigenous": "AI/AN", "Asian or Asian American": "Asian", "Native Hawaiian or Pacific Islander": "NH/PI", Multiracial: "Multiracial" };

const DAY_NUMS = new Map();
const dayNum = (iso) => DAY_NUMS.get(iso) ?? DAY_NUMS.set(iso, Date.parse(iso) / 864e5).get(iso);
const mid = (values) => { const v = [...values].sort((a, b) => a - b); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
const pct1 = (a, b) => Math.round((1000 * a) / b) / 10;
const fmt = (n) => n.toLocaleString("en-US");

export function summarizeMeridianHmis({ persons, enrollments, income_assessments }) {
  const who = new Map(persons.map((p) => [p.person_id, p]));
  const groupOf = (id) => { const p = who.get(id); return p.ethnicity === "Hispanic/Latina/e/o" ? "Hispanic" : SHORT_RACE[p.race] || "Unknown"; };
  const rows = enrollments.map((r) => ({ r, s: dayNum(r.entry_date), x: r.exit_date ? dayNum(r.exit_date) : null }));
  const mine = new Map();
  for (const e of rows) { if (!mine.has(e.r.person_id)) mine.set(e.r.person_id, []); mine.get(e.r.person_id).push(e); }
  for (const list of mine.values()) list.sort((a, b) => a.s - b.s);
  const active = (e, s, end) => e.s < end && (e.x == null || e.x > s);

  const year = {};
  for (const [fy, [a, b, pit]] of Object.entries(SUM_FY)) {
    const s = dayNum(a), end = dayNum(b), night = dayNum(pit);
    const nights = (types) => {
      const per = new Map();
      for (const e of rows) if (types.includes(e.r.project_type) && active(e, s, end)) per.set(e.r.person_id, (per.get(e.r.person_id) ?? 0) + Math.min(e.x ?? end, end) - e.s);
      return per;
    };
    const essh = nights(["ES", "SH"]), esshth = nights(["ES", "SH", "TH"]);
    const v1 = [...essh.values()], v2 = [...esshth.values()];
    const y = (year[fy] = {
      m1: { median: mid(v1), mean: Math.round(v1.reduce((t, n) => t + n, 0) / v1.length), medianTh: mid(v2) },
      m1ByHousehold: Object.fromEntries(HOUSEHOLDS.map((h) => [h, mid([...esshth].filter(([id]) => who.get(id).household_type === h).map(([, n]) => n))])),
      m32: esshth.size,
      m32ByHousehold: Object.fromEntries(HOUSEHOLDS.map((h) => [h, [...esshth.keys()].filter((id) => who.get(id).household_type === h).length])),
      familyShare: pct1([...esshth.keys()].filter((id) => who.get(id).household_type === "Families").length, esshth.size)
    });
    // 3.1
    const on = (e) => e.s <= night && (e.x == null || e.x > night);
    const sheltered = new Set(rows.filter((e) => ["ES", "SH", "TH"].includes(e.r.project_type) && on(e)).map((e) => e.r.person_id));
    const outside = new Set(rows.filter((e) => e.r.project_type === "SO" && on(e) && !sheltered.has(e.r.person_id)).map((e) => e.r.person_id));
    y.m31 = { sheltered: sheltered.size, unsheltered: outside.size, total: sheltered.size + outside.size };
    // 7b.1, 7a, 7b.2
    const lastExits = (types) => {
      const out = [];
      for (const list of mine.values()) {
        const mineT = list.filter((e) => types.includes(e.r.project_type));
        if (mineT.some((e) => e.s < end && (e.x == null || e.x >= end))) continue;
        const exits = mineT.filter((e) => e.x != null && e.x >= s && e.x < end);
        if (exits.length) out.push(exits[exits.length - 1].r);
      }
      return out;
    };
    const leavers = lastExits(["ES", "SH", "TH", "RRH"]);
    const housed = leavers.filter((r) => HOUSED.includes(r.destination));
    y.m7b1 = { n: leavers.length, housed: housed.length, pct: pct1(housed.length, leavers.length) };
    y.destinations = {};
    for (const r of leavers) y.destinations[r.destination] = (y.destinations[r.destination] ?? 0) + 1;
    y.unknownPct = pct1((y.destinations["DK / refused"] ?? 0) + (y.destinations["Not collected"] ?? 0), leavers.length);
    y.m7b1ByGroup = {};
    for (const r of leavers) { const g = (y.m7b1ByGroup[groupOf(r.person_id)] ??= { n: 0, housed: 0 }); g.n++; if (HOUSED.includes(r.destination)) g.housed++; }
    const so = lastExits(["SO"]).filter((r) => r.destination !== "Deceased");
    const stable = so.filter((r) => !["Place not meant for habitation", "DK / refused", "Not collected"].includes(r.destination)).length;
    y.m7a = { n: so.length, stable, pct: pct1(stable, so.length) };
    const psh = new Map();
    for (const e of rows) if (e.r.project_type === "PSH" && e.s < end && (e.x == null || e.x >= s)) psh.set(e.r.person_id, e);
    let kept = 0, inPsh = 0;
    for (const e of psh.values()) {
      if (e.x != null && e.x < end && e.r.destination === "Deceased") continue;
      inPsh++;
      if (e.x == null || e.x >= end || HOUSED.includes(e.r.destination)) kept++;
    }
    y.m7b2 = { n: inPsh, kept, pct: pct1(kept, inPsh) };
    // 4
    const byEnrollment = new Map();
    for (const a of income_assessments) { if (!byEnrollment.has(a.enrollment_id)) byEnrollment.set(a.enrollment_id, []); byEnrollment.get(a.enrollment_id).push(a); }
    const cell = () => ({ n: 0, earned: 0, other: 0, total: 0 });
    const m4 = { stayers: cell(), leavers: cell() }, counted = { stayers: new Set(), leavers: new Set() };
    for (let i = rows.length - 1; i >= 0; i--) {
      const e = rows[i];
      if (!["TH", "RRH", "PSH"].includes(e.r.project_type) || who.get(e.r.person_id).age_band === "Under 18") continue;
      const list = byEnrollment.get(e.r.enrollment_id) ?? [];
      const start = list.find((x) => x.assessment_point === "entry");
      if (!start) continue;
      let kind = null, later = null;
      if (e.x != null && e.x >= s && e.x < end) { kind = "leavers"; later = list.find((x) => x.assessment_point === "exit"); }
      else if (e.s < end && (e.x == null || e.x >= end)) { kind = "stayers"; later = list.filter((x) => x.assessment_point === "update" && dayNum(x.assessment_date) >= s && dayNum(x.assessment_date) < end).pop(); }
      if (!kind || !later || counted[kind].has(e.r.person_id)) continue;
      counted[kind].add(e.r.person_id);
      const c = m4[kind];
      c.n++;
      if (later.earned_income > start.earned_income) c.earned++;
      if (later.non_employment_cash_income > start.non_employment_cash_income) c.other++;
      if (later.total_income > start.total_income) c.total++;
    }
    y.m4 = m4;
  }

  // 2 and 5: FY2026 only (both need a two-year lookback inside the data).
  const fy26 = year.FY2026, cohortEnd = dayNum("2024-10-01");
  const returnGap = (list, exit) => {
    for (const e of list) {
      if (e.s <= exit.x) continue;
      const gap = e.s - exit.x;
      if (gap > 730) return null;
      if ((e.r.project_type === "RRH" || e.r.project_type === "PSH") && gap <= 14) continue;
      return gap;
    }
    return null;
  };
  const m2 = { cohort: 0, returns: 0, within6: 0, within12: 0, within24: 0, byGroup: {} };
  for (const list of mine.values()) {
    const exit = list.find((e) => e.x != null && e.x < cohortEnd && HOUSED.includes(e.r.destination));
    if (!exit) continue;
    const gap = returnGap(list, exit), g = (m2.byGroup[groupOf(exit.r.person_id)] ??= { n: 0, returns: 0 });
    m2.cohort++; g.n++;
    if (gap == null) continue;
    m2.returns++; g.returns++;
    if (gap <= 180) m2.within6++; else if (gap <= 365) m2.within12++; else m2.within24++;
  }
  m2.pct = pct1(m2.returns, m2.cohort);
  m2.within6Pct = pct1(m2.within6, m2.returns);
  fy26.m2 = m2;
  const s26 = dayNum(SUM_FY.FY2026[0]), e26 = dayNum(SUM_FY.FY2026[1]);
  const firstTime = new Set();
  for (const [id, list] of mine) {
    const first = list.find((e) => e.r.project_type !== "SO" && e.s >= s26 && e.s < e26);
    if (first && !list.some((e) => e !== first && e.r.project_type !== "SO" && e.s < first.s && (e.x == null || e.x >= first.s - 730))) firstTime.add(id);
  }
  fy26.m5 = firstTime.size;
  fy26.m5ByHousehold = Object.fromEntries(HOUSEHOLDS.map((h) => [h, [...firstTime].filter((id) => who.get(id).household_type === h).length]));
  return year;
}

// The packet datasets, from the summary.
function cocEditionDatasets(year) {
  const y25 = year.FY2025, y26 = year.FY2026;
  const pc = (n) => `${n.toFixed(1)}%`;
  const pts = (a, b) => `${b >= a ? "▲" : "▼"} ${Math.abs(Math.round((b - a) * 10) / 10)} pts vs FY2025`;
  const days = (a, b) => `${b > a ? "▲" : "▼"} ${Math.abs(b - a)} ${Math.abs(b - a) === 1 ? "day" : "days"} vs FY2025`;
  const m2 = y26.m2;
  const groups = EQUITY.filter((g) => (y26.m7b1ByGroup[g]?.n ?? 0) >= 20);
  const returnGroups = EQUITY.filter((g) => (m2.byGroup[g]?.n ?? 0) >= 20);
  const better = (a, b, lower) => (a === b ? "no change" : (b < a) === lower ? "improved" : "worsened");
  const destOrder = ["PH, subsidized", "PH, unsubsidized", "PH, with family", "Temp, with family", "Emergency shelter", "Place not meant for habitation", "Institutional", "Motel, no voucher", "Deceased", "DK / refused", "Not collected"];
  const m4Rows = [["4.1", "stayers", "earned", "Stayers: earned income increased"], ["4.2", "stayers", "other", "Stayers: non-employment cash income increased"], ["4.3", "stayers", "total", "Stayers: total income increased"], ["4.4", "leavers", "earned", "Leavers: earned income increased"], ["4.5", "leavers", "other", "Leavers: non-employment cash income increased"], ["4.6", "leavers", "total", "Leavers: total income increased"]];
  const m4Cell = (y, who, key) => `${pc(pct1(y.m4[who][key], y.m4[who].n))} (${fmt(y.m4[who][key])} of ${fmt(y.m4[who].n)})`;
  return {
    cocEdBoardKpis: [
      { label: "Exits to permanent housing (SPM 7b.1)", value: `${pc(y26.m7b1.pct)}`, delta: `${pts(y25.m7b1.pct, y26.m7b1.pct)} · CoC goal 45% · ${fmt(y26.m7b1.housed)} of ${fmt(y26.m7b1.n)} leavers`, deltaDir: y26.m7b1.pct >= y25.m7b1.pct ? "up" : "down" },
      { label: "Median days homeless (SPM 1a, ES/SH)", value: `${y26.m1.median} days`, delta: `${days(y25.m1.median, y26.m1.median)} · mean ${y26.m1.mean} days · lower is better`, deltaDir: y26.m1.median <= y25.m1.median ? "down" : "up", invert: true },
      { label: "Returned within 24 months (SPM 2)", value: `${pc(m2.pct)}`, delta: `${m2.returns} of ${fmt(m2.cohort)} housed in FY2024 · ${m2.within6} within 6 months · lower is better` },
      { label: "Homeless for the first time (SPM 5)", value: fmt(y26.m5), delta: `${pc(pct1(y26.m5, y26.m32))} of the annual count · no shelter or housing record in the prior 2 years` },
      { label: "People in shelter or TH this year (SPM 3.2)", value: fmt(y26.m32), delta: `${y26.m32 >= y25.m32 ? "▲" : "▼"} ${pc(pct1(y26.m32 - y25.m32, y25.m32))} vs FY2025 · families ${pc(y26.familyShare)} (FY2025 ${pc(y25.familyShare)})`, deltaDir: y26.m32 >= y25.m32 ? "up" : "down", invert: true }
    ],
    cocEdExitDestinations: destOrder.filter((d) => y26.destinations[d]).map((d) => ({ label: d, value: y26.destinations[d], group: HOUSED.includes(d) ? "Permanent" : ["DK / refused", "Not collected"].includes(d) ? "Unknown" : "Not permanent" })),
    cocEdEquity: [
      ...groups.map((g) => ({ facet: "Exits to permanent housing (%), FY2026", label: g, value: pct1(y26.m7b1ByGroup[g].housed, y26.m7b1ByGroup[g].n), n: y26.m7b1ByGroup[g].n })),
      ...returnGroups.map((g) => ({ facet: "Returned within 24 months (%), FY2024 housing exits", label: g, value: pct1(m2.byGroup[g].returns, m2.byGroup[g].n), n: m2.byGroup[g].n }))
    ],
    cocEdReturnsTiming: [
      { label: "Within 6 months", value: m2.within6, share: pct1(m2.within6, m2.returns), cohort: m2.cohort },
      { label: "6–12 months", value: m2.within12, share: pct1(m2.within12, m2.returns), cohort: m2.cohort },
      { label: "13–24 months", value: m2.within24, share: pct1(m2.within24, m2.returns), cohort: m2.cohort }
    ],
    cocEdInflowVsCount: HOUSEHOLDS.flatMap((h) => [
      { label: h, value: y26.m32ByHousehold[h], series: "In shelter or TH this year (SPM 3.2)" },
      { label: h, value: y26.m5ByHousehold[h], series: "First time homeless (SPM 5)" }
    ]),
    cocEdSpmTable: [
      { measure: "SPM 1a: median days, ES/SH", FY2025: String(y25.m1.median), FY2026: String(y26.m1.median), direction: better(y25.m1.median, y26.m1.median, true) },
      { measure: "SPM 1a: mean days, ES/SH", FY2025: String(y25.m1.mean), FY2026: String(y26.m1.mean), direction: better(y25.m1.mean, y26.m1.mean, true) },
      { measure: "SPM 1a: median days, ES/SH/TH", FY2025: String(y25.m1.medianTh), FY2026: String(y26.m1.medianTh), direction: better(y25.m1.medianTh, y26.m1.medianTh, true) },
      { measure: "SPM 2: returned within 24 months", FY2025: "not computable*", FY2026: `${pc(m2.pct)} (${m2.returns} of ${fmt(m2.cohort)})`, direction: "—" },
      { measure: "SPM 2: share of returns within 6 months", FY2025: "not computable*", FY2026: `${pc(m2.within6Pct)} (${m2.within6} of ${m2.returns})`, direction: "—" },
      { measure: "SPM 3.1: PIT night, HMIS-based", FY2025: fmt(y25.m31.total), FY2026: fmt(y26.m31.total), direction: better(y25.m31.total, y26.m31.total, true) },
      { measure: "SPM 3.2: annual count, ES/SH/TH", FY2025: fmt(y25.m32), FY2026: fmt(y26.m32), direction: better(y25.m32, y26.m32, true) },
      { measure: "SPM 5: first time homeless", FY2025: "not computable*", FY2026: fmt(y26.m5), direction: "—" },
      { measure: "SPM 7a: outreach exits to a stable place", FY2025: `${pc(y25.m7a.pct)}`, FY2026: `${pc(y26.m7a.pct)}`, direction: better(y25.m7a.pct, y26.m7a.pct, false) },
      { measure: "SPM 7b.1: exits to permanent housing", FY2025: `${pc(y25.m7b1.pct)}`, FY2026: `${pc(y26.m7b1.pct)}`, direction: better(y25.m7b1.pct, y26.m7b1.pct, false) },
      { measure: "SPM 7b.2: stayed in or left PSH for housing", FY2025: `${pc(y25.m7b2.pct)}`, FY2026: `${pc(y26.m7b2.pct)}`, direction: better(y25.m7b2.pct, y26.m7b2.pct, false) }
    ],
    cocEdFunderKpis: [
      { label: "Exits to permanent housing (SPM 7b.1)", value: `${pc(y26.m7b1.pct)}`, delta: `${pts(y25.m7b1.pct, y26.m7b1.pct)} · ${fmt(y26.m7b1.housed)} of ${fmt(y26.m7b1.n)} leavers`, deltaDir: y26.m7b1.pct >= y25.m7b1.pct ? "up" : "down" },
      { label: "Median days homeless (SPM 1a, ES/SH)", value: `${y26.m1.median} days`, delta: `${days(y25.m1.median, y26.m1.median)} · lower is better`, deltaDir: y26.m1.median <= y25.m1.median ? "down" : "up", invert: true },
      { label: "Leavers with more total income (SPM 4.6)", value: `${pc(pct1(y26.m4.leavers.total, y26.m4.leavers.n))}`, delta: `${pts(pct1(y25.m4.leavers.total, y25.m4.leavers.n), pct1(y26.m4.leavers.total, y26.m4.leavers.n))} · ${y26.m4.leavers.total} of ${y26.m4.leavers.n} adult leavers`, deltaDir: y26.m4.leavers.total / y26.m4.leavers.n >= y25.m4.leavers.total / y25.m4.leavers.n ? "up" : "down" },
      { label: "Stayed housed in PSH (SPM 7b.2)", value: `${pc(y26.m7b2.pct)}`, delta: `${pts(y25.m7b2.pct, y26.m7b2.pct)} · ${fmt(y26.m7b2.kept)} of ${fmt(y26.m7b2.n)} participants`, deltaDir: y26.m7b2.pct >= y25.m7b2.pct ? "up" : "down" }
    ],
    cocEdPeriodCompare: [
      ["Exits to permanent housing, SPM 7b.1", (y) => y.m7b1.pct],
      ["Stayed in or left PSH for housing, SPM 7b.2", (y) => y.m7b2.pct],
      ["Stayers with more total income, SPM 4.3", (y) => pct1(y.m4.stayers.total, y.m4.stayers.n)],
      ["Leavers with more total income, SPM 4.6", (y) => pct1(y.m4.leavers.total, y.m4.leavers.n)]
    ].flatMap(([facet, get]) => [{ facet, label: "FY2025", value: get(y25) }, { facet, label: "FY2026", value: get(y26) }]),
    cocEdIncomeTable: m4Rows.map(([id, who, key, name]) => ({ measure: `SPM ${id}: ${name}`, FY2025: m4Cell(y25, who, key), FY2026: m4Cell(y26, who, key) }))
  };
}

// ── CoC edition: lazy wiring ─────────────────────────────────────────────
// The microdata (about 25,000 rows) and the packet summaries are built on
// first use, not at import: the standalone export viewer imports this module
// too, and an export that does not use the edition should not pay for it.
// The packet datasets' columns are declared here so the pickers can be filled
// without building the data; tests/templates.test.mjs checks them.
//
// The microdata lives here, beside DATASETS, but is not a DATASETS entry:
// every DATASETS entry is loaded into DuckDB when the SQL panel first opens,
// and 25,000 more rows held that panel at "Loading" for several seconds.
// Read it with meridianHmis(); only the packet datasets are DATASETS entries.
const COC_EDITION_COLUMNS = Object.freeze({
  cocEdBoardKpis: ["label", "value", "delta", "deltaDir", "invert"],
  cocEdExitDestinations: ["label", "value", "group"],
  cocEdEquity: ["facet", "label", "value", "n"],
  cocEdReturnsTiming: ["label", "value", "share", "cohort"],
  cocEdInflowVsCount: ["label", "value", "series"],
  cocEdSpmTable: ["measure", "FY2025", "FY2026", "direction"],
  cocEdFunderKpis: ["label", "value", "delta", "deltaDir", "invert"],
  cocEdPeriodCompare: ["facet", "label", "value"],
  cocEdIncomeTable: ["measure", "FY2025", "FY2026"]
});
export const COC_EDITION_DATASET_KEYS = Object.freeze(Object.keys(COC_EDITION_COLUMNS));
export const COC_EDITION_DATASET_COLUMNS = COC_EDITION_COLUMNS;
const COC_EDITION_LABELS = {
  cocEdBoardKpis: "CoC edition — board packet headline KPIs, FY2026",
  cocEdExitDestinations: "CoC edition — exits by destination, FY2026 (SPM 7b.1)",
  cocEdEquity: "CoC edition — housing exits and returns by race/ethnicity",
  cocEdReturnsTiming: "CoC edition — returns by timing (SPM 2)",
  cocEdInflowVsCount: "CoC edition — first time vs annual count by household type",
  cocEdSpmTable: "CoC edition — SPM table, FY2025 vs FY2026",
  cocEdFunderKpis: "CoC edition — funder report KPIs, FY2026",
  cocEdPeriodCompare: "CoC edition — outcome measures, FY2025 vs FY2026",
  cocEdIncomeTable: "CoC edition — income growth, SPM 4.1–4.6"
};
let cocEdition = null;
/** The edition's microdata, its summary (every packet figure) and its datasets, built once. */
export function cocEditionData() {
  if (!cocEdition) {
    const hmis = generateMeridianHmis();
    const summary = summarizeMeridianHmis(hmis);
    cocEdition = { hmis, summary, datasets: cocEditionDatasets(summary) };
  }
  return cocEdition;
}
/** The Meridian HMIS microdata: { persons, enrollments, income_assessments }. */
export const meridianHmis = () => cocEditionData().hmis;
const defineCocEdition = (target, keys, value) => { for (const key of keys) Object.defineProperty(target, key, { enumerable: true, get: () => value(key) }); return target; };

// Sample datasets shipped with the app. Later phases will let tiles bind
// their own data (CSV/JSON upload, then DuckDB-WASM queries).
// states: synthetic per-state values (FIPS ids) for the choropleth sample;
// usStates is the TopoJSON topology the choropleth renders against.
// The ten generic samples stay first: fresh tiles default to them.
export const CORE_DATASET_KEYS = Object.freeze(["categorical", "timeseries", "scatter", "kpis", "states", "facets", "stacked", "boxdata", "heatmap", "treemap"]);
const MERIDIAN_FILES = { ...meridianCoc, ...meridianBh, ...meridianUds, ...meridianOverdose, ...meridianCommunity, ...meridianPrograms, ...meridianCs311, ...meridianScorecard, ...meridianExecutive, ...meridianSales, ...meridianStarter };
// The CoC edition's packet datasets are purpose-built Meridian datasets too (lazy; see above).
export const MERIDIAN_DATASETS = Object.freeze(defineCocEdition({ ...MERIDIAN_FILES }, COC_EDITION_DATASET_KEYS, (key) => cocEditionData().datasets[key]));
export const DATASETS = defineCocEdition({ categorical, timeseries, scatter, kpis, states, facets, stacked, boxdata, heatmap, treemap, ...MERIDIAN_FILES }, COC_EDITION_DATASET_KEYS, (key) => cocEditionData().datasets[key]);

export const DATASET_LABELS = {
  categorical: "Categories (8)",
  timeseries: "Monthly series (2)",
  scatter: "Scatter points (24)",
  kpis: "KPI cards (4)",
  states: "States — sample values (51)",
  facets: "Facets — 3 groups × 5 categories (15)",
  stacked: "Segment totals — 3 series × 8 categories (24)",
  boxdata: "Distribution groups — 4 × 30 values (120)",
  heatmap: "Service matrix — 6 × 5 cells (30)",
  treemap: "Program hierarchy — 4 groups (12)",
  ...Object.fromEntries(Object.keys(MERIDIAN_FILES).map((key) => [key, `${meridianLabels[key] || key} (${MERIDIAN_FILES[key].length})`]))
};
defineCocEdition(DATASET_LABELS, COC_EDITION_DATASET_KEYS, (key) => `${COC_EDITION_LABELS[key]} (${cocEditionData().datasets[key].length.toLocaleString("en-US")})`);

const sortControls = [{ type: "select", key: "sort", label: "Sort", default: "desc", options: [["desc", "Descending"], ["asc", "Ascending"], ["data", "Data order"]] }];
const topNControls = [{ type: "number", key: "topN", label: "Show top N categories", min: 1, max: 100, step: 1, default: "", allowEmpty: true }];
const referenceControls = [
  { type: "number", key: "referenceValue", label: "Reference value", step: "any", default: "", allowEmpty: true },
  { type: "textarea", key: "referenceLabel", label: "Reference label", default: "", maxLength: 120, rows: 1 }
];

// Pure normalization helpers live in ./normalize.js (no DOM/kit imports, so
// they're unit-testable in node); re-exported here for tile authors.
import { guessMapping, normalizeRows, promoteDate } from "./normalize.js";
export { guessMapping, normalizeRows, promoteDate };

// Mount helper for Plot-based charts: clears el, renders the chart function
// at the container's measured width, height, and wraps it in a themed card carrying
// the tile title and source line. Charts read the active theme themselves
// (see src/charts/charts.js), so a theme switch just re-renders the tiles.
function mount(el, chartFn, options) {
  el.replaceChildren();
  const frame = card(document.createElement('span'), { title: options.hideTitle ? null : options.title, source: options.source });
  el.append(frame);
  const width = Math.max(120, (el.clientWidth || 640) - 32);
  const chrome = frame.querySelector('.db-chart-head').offsetHeight + (frame.querySelector('.db-chart-source')?.offsetHeight || 0) + 48;
  const preferred = options.preferredHeight || 260;
  const height = options.sizing === 'auto' || !el.clientHeight ? preferred : Math.max(100, el.clientHeight - chrome - (options.footerHeight ?? 40) - (options.legendSpace || 0));
  frame.querySelector('.db-chart-body').replaceChildren(chartFn(width, height));
}

export const TILE_TYPES = {
  bar: {
    label: "Bar chart",
    description: "Ranked horizontal bars",
    // Data contract: declares what this tile needs. The upload flow builds its
    // column-mapping UI from these declarations (never hardcoded per type).
    // Uploaded files are normalized to rows keyed by field `key`, so render()
    // below keeps working unchanged.
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    controls: [...sortControls, ...topNControls, ...referenceControls],
    crossfilterField: "label",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => barChart(data, { x: "value", y: "label", sort: options.tileOptions?.sort === "data" ? null : options.tileOptions?.sort ?? "desc", width, height, xLabel: options.tileOptions?.xLabel || null, referenceValue: options.tileOptions?.referenceValue, referenceLabel: options.tileOptions?.referenceLabel, crossfilterField: options.crossfilterField }),
        options
      );
    }
  },

  column: {
    label: "Column chart",
    description: "Vertical bars by category",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    controls: [...sortControls, ...topNControls, ...referenceControls],
    crossfilterField: "label",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => columnChart(data, { x: "label", y: "value", sort: options.tileOptions?.sort === "data" ? null : options.tileOptions?.sort ?? "desc", width, height, yLabel: options.tileOptions?.yLabel || null, referenceValue: options.tileOptions?.referenceValue, referenceLabel: options.tileOptions?.referenceLabel, crossfilterField: options.crossfilterField }),
        options
      );
    }
  },

  line: {
    label: "Line chart",
    description: "Monthly time series",
    fields: [
      { key: "date", label: "X column — dates or categories" },
      { key: "value", label: "Value column", numeric: true },
      { key: "series", label: "Series column", optional: true }
    ],
    datasets: ["timeseries"],
    defaultDataset: "timeseries",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Monthly requests",
    controls: referenceControls,
    render(el, { data, options }) {
      // Promote "YYYY-MM" strings to Date so Plot uses a time axis.
      const rows = data.map((d) => ({ ...d, date: promoteDate(d.date) }));
      mount(
        el,
        (width, height) =>
          lineChart(rows, { x: "date", y: "value", stroke: "series", sourceRows: data, width, height, yLabel: options.tileOptions?.yLabel || null, referenceValue: options.tileOptions?.referenceValue, referenceLabel: options.tileOptions?.referenceLabel }),
        options
      );
    }
  },

  scatter: {
    label: "Scatter plot",
    description: "X/Y relationship, optional trend",
    fields: [
      { key: "x", label: "X column", numeric: true },
      { key: "y", label: "Y column", numeric: true },
      { key: "group", label: "Group column", optional: true }
    ],
    datasets: ["scatter"],
    defaultDataset: "scatter",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Rent burden vs. homelessness rate",
    controls: [{ key: "trend", label: "Trend line", type: "checkbox", default: true }, ...referenceControls],
    crossfilterField: "group",
    crossfilterFields: ["group"],
    render(el, { data, options }) {
      const trend = options.tileOptions?.trend ?? true;
      mount(
        el,
        (width, height) =>
          scatterChart(data, {
            x: "x",
            y: "y",
            fill: "group",
            trend,
            width, height,
            xLabel: options.tileOptions?.xLabel || null,
            yLabel: options.tileOptions?.yLabel || null,
            referenceValue: options.tileOptions?.referenceValue,
            referenceLabel: options.tileOptions?.referenceLabel,
            crossfilterField: options.crossfilterField
          }),
        options
      );
    }
  },

  dot: {
    label: "Dot plot",
    description: "Lollipop alternative to bars",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    controls: [...sortControls, ...topNControls, ...referenceControls],
    crossfilterField: "label",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => dotChart(data, { x: "value", y: "label", sort: options.tileOptions?.sort === "data" ? null : options.tileOptions?.sort ?? "desc", width, height, xLabel: options.tileOptions?.xLabel || null, referenceValue: options.tileOptions?.referenceValue, referenceLabel: options.tileOptions?.referenceLabel, crossfilterField: options.crossfilterField }),
        options
      );
    }
  },

  donut: {
    label: "Donut chart",
    description: "Parts of a whole (≤6 slices)",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 4, h: 6 },
    defaultTitle: "Share of requests",
    crossfilterField: "label",
    render(el, { data, options }) {
      mount(
        el,
        // The donut is square; cap the width so wide tiles don't blow it up.
        // The uncapped width and the height before the stacked legend's share
        // is taken off let donutChart put the legend beside the ring when the
        // tile is clearly wider than it is tall.
        (width, height) =>
          donutChart(data, {
            value: "value",
            label: "label",
            width: Math.min(width, 400), height,
            availableWidth: width, availableHeight: height + (options.legendSpace || 0) + (options.donutSpare || 0),
            crossfilterField: options.crossfilterField
          }),
        options
      );
    }
  },

  choropleth: {
    label: "Choropleth map",
    description: "US states shaded by value",
    // The id column is text: FIPS codes ("06") must keep their leading zero,
    // so it is deliberately NOT numeric. Uploads with a FIPS-like column map
    // here; the sample dataset uses the bundled us-states topology.
    fields: [
      { key: "id", label: "ID column (FIPS codes)" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["states"],
    defaultDataset: "states",
    defaultSize: { w: 8, h: 6 },
    defaultTitle: "Value by state",
    controls: [{ key: "diverging", label: "Diverging scale", type: "checkbox", default: false }],
    render(el, { data, options }) {
      const diverging = options.tileOptions?.diverging ?? false;
      mount(
        el,
        (width, height) =>
          choropleth(data, {
            geo: usStates,
            object: "states",
            id: "id",
            value: "value",
            diverging,
            width, height
          }),
        options
      );
    }
  },

  smallMultiples: {
    label: "Small multiples",
    description: "Faceted column charts, shared scale",
    // The kit's smallMultiples() takes a chart-builder callback; this tile
    // fixes the inner chart to columns and wires the shared y-domain through,
    // which is what keeps every panel honest.
    fields: [
      { key: "facet", label: "Facet column (one panel each)" },
      { key: "label", label: "Category column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["facets"],
    defaultDataset: "facets",
    defaultSize: { w: 12, h: 6 },
    defaultTitle: "Requests by category and region",
    controls: [
      { key: "includeZero", label: "Include zero in shared scale", type: "checkbox", default: true },
      // Default stays "desc" (largest first); time-ordered panels use "data".
      ...sortControls
    ],
    render(el, { data, options }) {
      const includeZero = options.tileOptions?.includeZero ?? true;
      mount(
        el,
        (width, height) => {
          const count = new Set(data.map(d => d.facet)).size;
          const { columns, panelWidth: chartWidth, width: gridWidth } = facetGeometry(width, count);
          const scrolls = gridWidth > width;
          const chartHeight = Math.max(100, height - 44 - (scrolls ? 40 : 0));
          const panels = smallMultiples(data, {
            facet: "facet",
            value: "value",
            columns,
            includeZero,
            chartWidth,
            chart: (rows, { yDomain, width: cw }) =>
              columnChart(rows, { x: "label", y: "value", sort: options.tileOptions?.sort === "data" ? null : options.tileOptions?.sort ?? "desc", width: cw, height: chartHeight, yDomain, yLabel: options.tileOptions?.yLabel || null })
          });
          panels.style.minWidth = `${gridWidth}px`;
          const region = document.createElement('div');
          region.className = 'db-facets-scroll';
          region.style.overflowX = 'auto';
          region.style.maxWidth = '100%';
          region.tabIndex = 0;
          region.setAttribute('role', 'region');
          region.setAttribute('aria-label', 'Small multiples panels');
          region.append(panels);
          const content = document.createElement('div');
          if (scrolls) {
            const hint = document.createElement('p');
            hint.className = 'db-facets-scroll-hint';
            hint.textContent = 'Scroll horizontally to compare all panels.';
            content.append(hint);
          }
          content.append(region);
          return content;
        },
        options
      );
    }
  },

  kpi: {
    label: "KPI row",
    description: "Headline metric cards",
    // KPI values render as given text (format them in your data: "$1,287",
    // "13.6", "0.334"). deltaDir accepts "up"/"down"; when a delta is mapped
    // without a direction, the sign is derived automatically.
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column" },
      { key: "delta", label: "Change text", optional: true },
      { key: "deltaDir", label: "Direction (up/down)", optional: true }
    ],
    datasets: ["kpis"],
    defaultDataset: "kpis",
    defaultSize: { w: 12, h: 2 },
    defaultTitle: "Headlines",
    render(el, { data, options }) {
      // KPI cards carry their own layout; no width plumbing needed.
      el.innerHTML = "";
      el.appendChild(card(kpiRow(data), { title: options.hideTitle ? null : options.title, source: options.source }));
    }
  },

  table: {
    label: "Table", description: "Scrollable rows and source columns", fields: [], dynamicFields: true,
    datasets: ["categorical"], defaultDataset: "categorical", defaultSize: {w:12,h:8}, defaultTitle: "Data table",
    render(el,{data,options}) { el.replaceChildren(dataTableChart(data,options)); }
  },

  text: {
    label: "Text / annotation", description: "Notes, headings and methodology", fields: [], noData: true,
    datasets: [], defaultSize: {w:12,h:2}, defaultTitle: "Annotation",
    controls: [{type:"textarea",key:"body",label:"Text",default:"",maxLength:10000,rows:5}],
    render(el,{options}) { el.replaceChildren(textAnnotation(options.tileOptions?.body || "")); }
  },

  stackedBar: {
    label: "Stacked bar", description: "Compare series across categories", fields:[
      {key:"label",label:"Category column"},{key:"value",label:"Value column",numeric:true},{key:"series",label:"Series column"}
    ], datasets:["stacked"], defaultDataset:"stacked", defaultSize:{w:6,h:7}, defaultTitle:"Segment mix by category",
    controls:[{type:"select",key:"mode",label:"Mode",default:"stacked",options:[["stacked","Stacked"],["grouped","Grouped"]]},...topNControls],
    crossfilterField:"label",
    render(el,{data,options}) { mount(el,(width,height)=>stackedBarChart(data,{mode:options.tileOptions?.mode||"stacked",width,height,xLabel:options.tileOptions?.xLabel||null,crossfilterField:options.crossfilterField}),options); }
  },

  stackedColumn: {
    label: "Stacked column", description: "Vertical series by category", fields:[
      {key:"label",label:"Category column"},{key:"value",label:"Value column",numeric:true},{key:"series",label:"Series column"}
    ], datasets:["stacked"], defaultDataset:"stacked", defaultSize:{w:6,h:7}, defaultTitle:"Category totals by segment",
    controls:[{type:"select",key:"mode",label:"Mode",default:"stacked",options:[["stacked","Stacked"],["grouped","Grouped"]]},...topNControls],
    crossfilterField:"label",
    render(el,{data,options}) { mount(el,(width,height)=>stackedColumnChart(data,{mode:options.tileOptions?.mode||"stacked",width,height,yLabel:options.tileOptions?.yLabel||null,crossfilterField:options.crossfilterField}),options); }
  },

  histogram: {
    label: "Histogram", description: "Distribution of numeric values", fields:[{key:"value",label:"Numeric value",numeric:true}],
    datasets:["scatter"], defaultDataset:"scatter", defaultSize:{w:6,h:7}, defaultTitle:"Value distribution",
    controls:[{type:"number",key:"binCount",label:"Bins",default:20,min:5,max:100,step:1},...referenceControls],
    render(el,{data,options}) { const rows=data.map(d=>({...d,value:d.value??d.y??d.x})); mount(el,(width,height)=>histogramChart(rows,{value:"value",preBinned:options.preBinnedHistogram===true,bins:Math.min(100,Math.max(5,Math.round(+options.tileOptions?.binCount||20))),width,height,xLabel:options.tileOptions?.xLabel||null,referenceValue:options.tileOptions?.referenceValue,referenceLabel:options.tileOptions?.referenceLabel}),options); }
  },

  boxplot: {
    label: "Box plot", description: "Compare category distributions", fields:[{key:"label",label:"Category column"},{key:"value",label:"Numeric value",numeric:true}],
    datasets:["boxdata"], defaultDataset:"boxdata", defaultSize:{w:6,h:7}, defaultTitle:"Distribution by group",
    controls:referenceControls,
    render(el,{data,options}) { mount(el,(width,height)=>boxplotChart(data,{width,height,yLabel:options.tileOptions?.yLabel||null,referenceValue:options.tileOptions?.referenceValue,referenceLabel:options.tileOptions?.referenceLabel}),options); }
  },

  area: {
    label: "Area chart", description: "Filled time series", fields:[{key:"date",label:"Date column"},{key:"value",label:"Numeric value",numeric:true},{key:"series",label:"Series column",optional:true}],
    datasets:["timeseries"], defaultDataset:"timeseries", defaultSize:{w:8,h:7}, defaultTitle:"Volume over time",
    controls:referenceControls,
    render(el,{data,options}) { const rows=data.map(d=>({...d,date:promoteDate(d.date)})); mount(el,(width,height)=>areaChart(rows,{series:rows.some(d=>d.series!=null)?"series":null,sourceRows:data,width,height,xLabel:options.tileOptions?.xLabel||null,yLabel:options.tileOptions?.yLabel||null,referenceValue:options.tileOptions?.referenceValue,referenceLabel:options.tileOptions?.referenceLabel}),{...options,legendSpace:options.legendSpace??32}); }
  },

  heatmap: {
    label: "Heatmap", description: "Category by category matrix", fields:[{key:"x",label:"X category"},{key:"y",label:"Y category"},{key:"value",label:"Value",numeric:true}],
    datasets:["heatmap"], defaultDataset:"heatmap", defaultSize:{w:8,h:8}, defaultTitle:"Service matrix",
    render(el,{data,options}) { mount(el,(width,height)=>heatmapChart(data,{width,height,xLabel:options.tileOptions?.xLabel||null,yLabel:options.tileOptions?.yLabel||null}),options); }
  },

  treemap: {
    label: "Treemap", description: "Hierarchical part-to-whole", fields:[{key:"label",label:"Category column"},{key:"value",label:"Value column",numeric:true},{key:"parent",label:"Parent group",optional:true}],
    datasets:["treemap"], defaultDataset:"treemap", defaultSize:{w:8,h:7}, defaultTitle:"Program composition",
    render(el,{data,options}) { el.replaceChildren(card(treemapChart(data,{width:Math.max(240,el.clientWidth-32),height:Math.max(180,el.clientHeight-140)}),{title:options.hideTitle?null:options.title,source:options.source})); }
  }
};

// Offer each Meridian dataset in the pickers of the tile types whose required
// fields it already carries (default mappings only — no per-tile remapping).
// Tables list the datasets built as tables. The generic sample stays first.
for (const [type, entry] of Object.entries(TILE_TYPES)) {
  if (entry.noData) continue;
  const shapes = [...Object.entries(MERIDIAN_FILES).map(([key, rows]) => [key, rows.flatMap((row) => Object.keys(row))]), ...Object.entries(COC_EDITION_DATASET_COLUMNS)];
  for (const [key, keys] of shapes) {
    const columns = new Set(keys);
    const fits = entry.dynamicFields ? /Table$/.test(key) : entry.fields.filter((f) => !f.optional).every((f) => columns.has(f.key));
    if (fits) entry.datasets.push(key);
  }
}

const lastRender = new WeakMap();
export function resizeTileChart(el, options = {}) {
  // An unavailable/loading state must never resurrect a previous dataset.
  if (!el?.querySelector('.db-card')) return;
  const last = lastRender.get(el);
  if (last) TILE_TYPES[last.type].render(el, { data: last.data, options: { ...last.options, ...options, resizeOnly: true } });
}

// One integrity boundary for both composer and standalone exports.
for (const [type, entry] of Object.entries(TILE_TYPES)) {
  entry.defaultSize.h *= 3;
  const render = entry.render;
  entry.render = (el, { data, options = {} }) => {
    const previousDetails = options.resizeOnly ? el.querySelector('.chart-data') : null;
    if (!options.resizeOnly) el.querySelectorAll('.chart-data').forEach(details => details.remove());
    lastRender.set(el, { type, data, options });
    options = { ...options, donutSpare: 0, preferredHeight: type === 'bar' || type === 'dot' ? Math.min(600, Math.max(220, data.length * 24 + 50)) : type === 'donut' ? 340 : type === 'table' ? 420 : type === 'treemap' ? 380 : 260, legendSpace: options.legendSpace ?? (['line','area'].includes(type) ? 32 : 0) };
    try {
      for (const f of entry.fields.filter(f => f.numeric)) {
        for (const r of data) {
          const v = r[f.key];
          if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw new Error('Unsupported numeric precision or type in ' + f.key + '. Use a KPI/text field or explicitly round in SQL.');
        }
      }
      const prepared = renderData(type,data);
      render(el,{ data: prepared.rows, options });
      if (prepared.note || (type === 'smallMultiples' && options.tileOptions?.includeZero === false)) {
        const note = document.createElement('p'); note.className = 'chart-transform-note';
        note.textContent = prepared.note || 'Cropped shared domain selected: zero may be excluded.'; el.append(note);
      }
      for (const svg of el.querySelectorAll('svg')) {
        const title=options.title||entry.label;
        const interactive=!!options.crossfilterField&&[...svg.querySelectorAll('a')].some(mark=>(mark.getAttributeNS('http://www.w3.org/1999/xlink','href')||mark.getAttribute('href')||'').startsWith('#db-crossfilter:'));
        svg.setAttribute('role',interactive?'group':'img');
        svg.setAttribute('aria-label',interactive?`${title}. Interactive chart; activate a category to filter other charts.`:title);
      }
    } catch (err) {
      el.replaceChildren(); const error = document.createElement('div'); error.className = 'tile-error'; error.setAttribute('role','alert'); error.textContent = err.message; el.append(error);
    }
    if (!entry.dynamicFields && !entry.noData) {
      const known = new Set(entry.fields.map(field => field.key));
      const sourceFields = [...new Set(data.flatMap(row => Object.keys(row)))].filter(key => !known.has(key)).map(key => ({ key }));
      el.append(previousDetails || chartData(data,[...entry.fields,...sourceFields],options.title));
    }
    if (options.sizing !== 'auto' && el.clientHeight && el.querySelector('.db-card')) {
      const extras = [...el.children].filter(node => !node.classList.contains('db-card'));
      const footerHeight = extras.reduce((sum, node) => {
        const css = getComputedStyle(node);
        return sum + node.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
      }, 0);
      let legendSpace = 0;
      if (type === 'donut') {
        const legend = el.querySelector('.db-legend');
        // Side by side, the legend takes width, not height, from the ring.
        legendSpace = el.querySelector('.db-donut-side') ? 0 : Math.max(0, legend.getBoundingClientRect().height + parseFloat(getComputedStyle(legend).marginTop) - 80);
      } else if (type !== 'smallMultiples') {
        // Anything in the chart body besides the plot (Plot's color legend on
        // line/area/stacked charts, the heatmap ramp) takes height from it, or
        // the tile's data row is pushed out of the tile (PR #42 review, B6).
        const body = el.querySelector('.db-chart-body');
        const plot = body && [...body.querySelectorAll('svg')].sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        if (plot) legendSpace = Math.max(0, body.getBoundingClientRect().height - plot.getBoundingClientRect().height);
      }
      if (Math.abs(footerHeight - (options.footerHeight ?? 40)) > 1 || Math.abs(legendSpace - (options.legendSpace || 0)) > 1) {
        options = { ...options, footerHeight, legendSpace };
        render(el, { data: renderData(type,data).rows, options });
        el.append(...extras);
        for (const svg of el.querySelectorAll('svg')) {
          const title=options.title||entry.label;
          const interactive=!!options.crossfilterField&&[...svg.querySelectorAll('a')].some(mark=>(mark.getAttributeNS('http://www.w3.org/1999/xlink','href')||mark.getAttribute('href')||'').startsWith('#db-crossfilter:'));
          svg.setAttribute('role',interactive?'group':'img');
          svg.setAttribute('aria-label',interactive?`${title}. Interactive chart; activate a category to filter other charts.`:title);
        }
      }
      // A side-by-side donut is sized from estimates of the tile's chrome. Once
      // the note and data row are in place, hand any height still unused back
      // to the ring, so it fills the tile the way the plotted charts do.
      if (type === 'donut' && el.querySelector('.db-donut-side')) {
        const top = el.getBoundingClientRect().top;
        const used = Math.max(...[...el.children].map(node => node.getBoundingClientRect().bottom + parseFloat(getComputedStyle(node).marginBottom))) - top;
        const spare = Math.floor(el.clientHeight - used) - 4;
        if (spare > 6) {
          const extras = [...el.children].filter(node => !node.classList.contains('db-card'));
          options = { ...options, donutSpare: spare };
          render(el, { data: renderData(type,data).rows, options });
          el.append(...extras);
          for (const svg of el.querySelectorAll('svg')) {
            const title=options.title||entry.label;
            const interactive=!!options.crossfilterField&&[...svg.querySelectorAll('a')].some(mark=>(mark.getAttributeNS('http://www.w3.org/1999/xlink','href')||mark.getAttribute('href')||'').startsWith('#db-crossfilter:'));
            svg.setAttribute('role',interactive?'group':'img');
            svg.setAttribute('aria-label',interactive?`${title}. Interactive chart; activate a category to filter other charts.`:title);
          }
        }
      }
      lastRender.set(el, {type, data, options});
    }
  };
}
