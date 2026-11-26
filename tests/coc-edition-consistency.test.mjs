// CoC edition consistency gate (Stage 1b §4): recompute the packet's headline
// figures from the Meridian HMIS microdata alone, with this file's own
// implementation of each measure's rules, and assert each equals what the
// packet tiles, titles and notes display (at the rounding they show).
//
// Independence: this file reads only the three microdata tables
// (meridianHmis(): persons, enrollments, income_assessments) to compute, and the
// packet datasets / template text to compare. It never imports the product's
// summary code (summarizeMeridianHmis).
//
// Run alone:  node --no-warnings --loader ./tests/json-loader.mjs --test tests/coc-edition-consistency.test.mjs
// Dump the microdata as CSV for an outside recomputation:
//   COC_EDITION_DUMP=/some/dir node --no-warnings --loader ./tests/json-loader.mjs --test tests/coc-edition-consistency.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!globalThis.document) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://localhost/', pretendToBeVisual: true });
  for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'NodeList', 'HTMLCollection', 'CustomEvent', 'getComputedStyle']) {
    try { globalThis[k] = k === 'window' ? dom.window : dom.window[k]; } catch { /* read-only global */ }
  }
  globalThis.localStorage = dom.window.localStorage;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
}

const { DATASETS, meridianHmis, generateMeridianHmis } = await import('../src/tiles/registry.js');
const { COC_EDITION_TEMPLATES } = await import('../src/templates.js');

const { persons, enrollments, income_assessments: income } = meridianHmis();
const board = COC_EDITION_TEMPLATES.find(t => t.id === 'coc-board-packet');
const funder = COC_EDITION_TEMPLATES.find(t => t.id === 'coc-funder-report');
const tileText = (tpl, title) => tpl.tiles.find(t => t.title.startsWith(title));

// ── Independent recomputation ────────────────────────────────────────────
const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const DAY = 86400000;
const YEARS = {
  FY2024: { from: ms('2023-10-01'), to: ms('2024-10-01') },
  FY2025: { from: ms('2024-10-01'), to: ms('2025-10-01'), pit: ms('2025-01-29') },
  FY2026: { from: ms('2025-10-01'), to: ms('2026-10-01'), pit: ms('2026-01-28') }
};
const PERMANENT = new Set(['PH, subsidized', 'PH, unsubsidized', 'PH, with family']);
const person = new Map(persons.map(p => [p.person_id, p]));
const raceGroup = (id) => {
  const p = person.get(id);
  if (p.ethnicity === 'Hispanic/Latina/e/o') return 'Hispanic';
  return { 'Black, African American, or African': 'Black', White: 'White', Multiracial: 'Multiracial', 'American Indian, Alaska Native, or Indigenous': 'AI/AN', 'Asian or Asian American': 'Asian', 'Native Hawaiian or Pacific Islander': 'NH/PI' }[p.race] ?? 'Unknown';
};
const stays = enrollments.map(r => ({ ...r, in: ms(r.entry_date), out: r.exit_date == null ? null : ms(r.exit_date) }));
const history = new Map();
for (const s of stays) { if (!history.has(s.person_id)) history.set(s.person_id, []); history.get(s.person_id).push(s); }
for (const list of history.values()) list.sort((a, b) => a.in - b.in);
const medianOf = (values) => { const v = [...values].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const pct = (a, b) => ((100 * a) / b).toFixed(1);
const comma = (n) => n.toLocaleString('en-US');

// Measure 1, 1a universe: per person, nights in ES/SH stays active in the
// year, each counted from entry to exit (or to year end if still open).
function measure1(fy, types) {
  const { from, to } = YEARS[fy];
  const nights = new Map();
  for (const s of stays) {
    if (!types.includes(s.project_type) || s.in >= to || (s.out != null && s.out <= from)) continue;
    nights.set(s.person_id, (nights.get(s.person_id) ?? 0) + (Math.min(s.out ?? to, to) - s.in) / DAY);
  }
  return nights;
}
// Measure 7b.1: ES/SH/TH/RRH leavers (nothing still open at year end), by last exit.
function leaversOf(fy, types = ['ES', 'SH', 'TH', 'RRH']) {
  const { from, to } = YEARS[fy];
  const out = [];
  for (const list of history.values()) {
    const own = list.filter(s => types.includes(s.project_type));
    if (own.some(s => s.in < to && (s.out == null || s.out >= to))) continue;
    const exits = own.filter(s => s.out != null && s.out >= from && s.out < to);
    if (exits.length) out.push(exits.at(-1));
  }
  return out;
}
// Measure 2: first housing exit in FY2024; a return is any later entry within
// 730 days, except a PH (RRH/PSH) entry within 14 days (the same move).
function measure2() {
  const result = { cohort: 0, returns: 0, within6: 0, mid: 0, late: 0, byGroup: {} };
  for (const list of history.values()) {
    const exit = list.find(s => s.out != null && s.out < YEARS.FY2024.to && PERMANENT.has(s.destination));
    if (!exit) continue;
    const g = (result.byGroup[raceGroup(exit.person_id)] ??= { n: 0, returns: 0 });
    result.cohort++; g.n++;
    let gap = null;
    for (const s of list) {
      if (s.in <= exit.out) continue;
      const days = (s.in - exit.out) / DAY;
      if (days > 730) break;
      if ((s.project_type === 'RRH' || s.project_type === 'PSH') && days <= 14) continue;
      gap = days; break;
    }
    if (gap == null) continue;
    result.returns++; g.returns++;
    if (gap <= 180) result.within6++; else if (gap <= 365) result.mid++; else result.late++;
  }
  return result;
}
// Measure 5: first ES/SH/TH/PH entry in FY2026 with no ES/SH/TH/PH record
// in the 730 days before it ("first time in this system within the lookback").
function measure5() {
  const { from, to } = YEARS.FY2026;
  const first = [];
  for (const [id, list] of history) {
    const entry = list.find(s => s.project_type !== 'SO' && s.in >= from && s.in < to);
    if (!entry) continue;
    const seen = list.some(s => s !== entry && s.project_type !== 'SO' && s.in < entry.in && (s.out == null || s.out >= entry.in - 730 * DAY));
    if (!seen) first.push(id);
  }
  return first;
}
const m1 = { FY2025: measure1('FY2025', ['ES', 'SH']), FY2026: measure1('FY2026', ['ES', 'SH']) };
const m1th = { FY2025: measure1('FY2025', ['ES', 'SH', 'TH']), FY2026: measure1('FY2026', ['ES', 'SH', 'TH']) };
const m2 = measure2();
const m5 = measure5();
const leavers = { FY2025: leaversOf('FY2025'), FY2026: leaversOf('FY2026') };
const housed = (list) => list.filter(s => PERMANENT.has(s.destination)).length;
const kpi = (rows, label) => rows.find(r => r.label.startsWith(label));
const spm = (measure) => DATASETS.cocEdSpmTable.find(r => r.measure === measure);

// ── The microdata itself ────────────────────────────────────────────────
test('microdata: HMIS-shaped tables, FY2024–FY2026, synthetic Meridian records, deterministic', () => {
  assert.deepEqual(Object.keys(persons[0]), ['person_id', 'age_band', 'race', 'ethnicity', 'veteran_status', 'disabling_condition', 'household_type']);
  assert.deepEqual(Object.keys(enrollments[0]), ['enrollment_id', 'person_id', 'household_id', 'project_name', 'project_type', 'entry_date', 'exit_date', 'destination']);
  assert.deepEqual(Object.keys(income[0]), ['assessment_id', 'enrollment_id', 'person_id', 'assessment_point', 'assessment_date', 'earned_income', 'non_employment_cash_income', 'total_income']);
  for (const s of stays) {
    assert.ok(['ES', 'SH', 'TH', 'PSH', 'RRH', 'SO', 'PH'].includes(s.project_type), s.project_type);
    assert.ok(person.has(s.person_id), s.enrollment_id);
    assert.ok(s.out == null || (s.out > s.in && s.out < YEARS.FY2026.to), s.enrollment_id);
    assert.ok(s.out == null || s.out >= YEARS.FY2024.from, `${s.enrollment_id} is active in the span`);
    assert.equal(s.out == null, s.destination == null, s.enrollment_id);
  }
  const enrolled = new Set(enrollments.map(r => r.enrollment_id));
  for (const a of income) {
    assert.ok(enrolled.has(a.enrollment_id), a.assessment_id);
    assert.ok(['entry', 'update', 'exit'].includes(a.assessment_point));
    assert.equal(a.total_income, a.earned_income + a.non_employment_cash_income, a.assessment_id);
  }
  const again = generateMeridianHmis();
  assert.equal(JSON.stringify(again.enrollments), JSON.stringify(enrollments), 'seeded generator is deterministic');
  // Row counts per table per fiscal year (handback evidence).
  const counts = {};
  for (const fy of Object.keys(YEARS)) {
    const { from, to } = YEARS[fy];
    const act = stays.filter(s => s.in < to && (s.out == null || s.out >= from));
    counts[fy] = {
      persons: new Set(act.map(s => s.person_id)).size,
      enrollments: act.length,
      income_assessments: income.filter(a => ms(a.assessment_date) >= from && ms(a.assessment_date) < to).length
    };
  }
  console.log('# microdata rows', JSON.stringify({ persons: persons.length, enrollments: enrollments.length, income_assessments: income.length, activeByYear: counts }));
  if (process.env.COC_EDITION_DUMP) {
    const dir = process.env.COC_EDITION_DUMP; mkdirSync(dir, { recursive: true });
    const csv = (rows) => [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(v => v == null ? '' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(','))].join('\n') + '\n';
    writeFileSync(join(dir, 'persons.csv'), csv(persons));
    writeFileSync(join(dir, 'enrollments.csv'), csv(enrollments));
    writeFileSync(join(dir, 'income_assessments.csv'), csv(income));
  }
});

// ── Measure 1 ────────────────────────────────────────────────────────────
test('Measure 1 (1a universe): medians recomputed from the microdata equal the packet tiles', () => {
  const med = { FY2025: medianOf(m1.FY2025.values()), FY2026: medianOf(m1.FY2026.values()) };
  const mean = { FY2025: Math.round([...m1.FY2025.values()].reduce((a, b) => a + b, 0) / m1.FY2025.size), FY2026: Math.round([...m1.FY2026.values()].reduce((a, b) => a + b, 0) / m1.FY2026.size) };
  const medTh = { FY2025: medianOf(m1th.FY2025.values()), FY2026: medianOf(m1th.FY2026.values()) };
  for (const rows of [DATASETS.cocEdBoardKpis, DATASETS.cocEdFunderKpis]) assert.equal(kpi(rows, 'Median days homeless (SPM 1a').value, `${med.FY2026} days`);
  assert.match(kpi(DATASETS.cocEdBoardKpis, 'Median days homeless').delta, new RegExp(`mean ${mean.FY2026} days`));
  assert.deepEqual([spm('SPM 1a: median days, ES/SH').FY2025, spm('SPM 1a: median days, ES/SH').FY2026], [String(med.FY2025), String(med.FY2026)]);
  assert.deepEqual([spm('SPM 1a: mean days, ES/SH').FY2025, spm('SPM 1a: mean days, ES/SH').FY2026], [String(mean.FY2025), String(mean.FY2026)]);
  assert.deepEqual([spm('SPM 1a: median days, ES/SH/TH').FY2025, spm('SPM 1a: median days, ES/SH/TH').FY2026], [String(medTh.FY2025), String(medTh.FY2026)]);
  // The worked annotation: household-type medians (ES/SH/TH), family share, overall medians.
  const note = tileText(board, 'What the measures say').tileOptions.body;
  const byType = (fy, type) => medianOf([...m1th[fy]].filter(([id]) => person.get(id).household_type === type).map(([, n]) => n));
  for (const [type, label] of [['Adults only', 'adults only'], ['Families', 'families'], ['Youth 18–24', 'youth 18–24'], ['Veterans', 'veterans']]) {
    assert.ok(note.includes(`${label} ${byType('FY2025', type)} → ${byType('FY2026', type)}`), `${type} medians in the note`);
    assert.ok(byType('FY2026', type) < byType('FY2025', type), `${type} median fell`);
  }
  const familyShare = (fy) => pct([...m1th[fy].keys()].filter(id => person.get(id).household_type === 'Families').length, m1th[fy].size);
  assert.ok(note.includes(`grew from ${familyShare('FY2025')}% to ${familyShare('FY2026')}%`));
  assert.ok(note.includes(`ES/SH ${med.FY2025} → ${med.FY2026} days; ES/SH/TH ${medTh.FY2025} → ${medTh.FY2026}`));
  const funderNote = tileText(funder, 'What the measures say').tileOptions.body;
  assert.ok(funderNote.includes(`median stay in shelter fell from ${med.FY2025} to ${med.FY2026} days`));
  console.log('# Measure 1', JSON.stringify({ medianESSH: med, meanESSH: mean, medianESSHTH: medTh }));
});

// ── Measure 2 ────────────────────────────────────────────────────────────
test('Measure 2: total return rate and within-6-months share recomputed from the microdata equal the packet tiles', () => {
  const rate = pct(m2.returns, m2.cohort), early = pct(m2.within6, m2.returns);
  const k = kpi(DATASETS.cocEdBoardKpis, 'Returned within 24 months');
  assert.equal(k.value, `${rate}%`);
  assert.ok(k.delta.startsWith(`${m2.returns} of ${comma(m2.cohort)} housed in FY2024 · ${m2.within6} within 6 months`), k.delta);
  assert.equal(spm('SPM 2: returned within 24 months').FY2026, `${rate}% (${m2.returns} of ${comma(m2.cohort)})`);
  assert.equal(spm('SPM 2: share of returns within 6 months').FY2026, `${early}% (${m2.within6} of ${m2.returns})`);
  assert.deepEqual(DATASETS.cocEdReturnsTiming.map(r => r.value), [m2.within6, m2.mid, m2.late]);
  assert.equal(tileText(board, `${m2.within6} of ${m2.returns} returns came within six months`)?.type, 'bar');
  for (const row of DATASETS.cocEdEquity.filter(r => r.facet.startsWith('Returned'))) {
    const g = m2.byGroup[row.label];
    assert.ok(g.n >= 20, `${row.label} shown only with 20+ people`);
    assert.equal(row.value.toFixed(1), pct(g.returns, g.n), row.label);
    assert.equal(row.n, g.n, row.label);
  }
  for (const [g, o] of Object.entries(m2.byGroup)) if (o.n >= 20 && g !== 'Unknown') assert.ok(DATASETS.cocEdEquity.some(r => r.facet.startsWith('Returned') && r.label === g), `${g} not suppressed`);
  const note = tileText(board, 'What the measures say').tileOptions.body;
  assert.ok(note.includes(`returned within 24 months at ${pct(m2.byGroup.Black.returns, m2.byGroup.Black.n)}% vs ${pct(m2.byGroup.White.returns, m2.byGroup.White.n)}%`));
  assert.ok(note.includes(`${m2.within6} of ${m2.returns} returns came within 6 months`));
  console.log('# Measure 2', JSON.stringify({ cohort: m2.cohort, returns: m2.returns, rate, within6: m2.within6, earlyShare: early, byGroup: m2.byGroup }));
});

// ── Measure 5 ────────────────────────────────────────────────────────────
test('Measure 5: first-time count over the two-year lookback recomputed from the microdata equals the packet tiles', () => {
  assert.equal(kpi(DATASETS.cocEdBoardKpis, 'Homeless for the first time').value, comma(m5.length));
  assert.equal(spm('SPM 5: first time homeless').FY2026, comma(m5.length));
  assert.equal(spm('SPM 5: first time homeless').FY2025, 'not computable*', 'FY2025 would need a lookback before the data');
  const series = DATASETS.cocEdInflowVsCount.filter(r => r.series.startsWith('First time'));
  for (const row of series) assert.equal(row.value, m5.filter(id => person.get(id).household_type === row.label).length, row.label);
  // Beside it, the annual count (3.2): people with an ES/SH/TH stay active in FY2026.
  const annual = DATASETS.cocEdInflowVsCount.filter(r => r.series.startsWith('In shelter'));
  for (const row of annual) assert.equal(row.value, [...m1th.FY2026.keys()].filter(id => person.get(id).household_type === row.label).length, row.label);
  assert.equal(kpi(DATASETS.cocEdBoardKpis, 'People in shelter or TH').value, comma(m1th.FY2026.size));
  console.log('# Measure 5', JSON.stringify({ firstTime: m5.length, annualCount: m1th.FY2026.size }));
});

// ── Measure 7b.1 ─────────────────────────────────────────────────────────
test('Measure 7b.1: exit-to-housing share recomputed from the microdata equals the packet tiles', () => {
  const share = (fy) => pct(housed(leavers[fy]), leavers[fy].length);
  for (const rows of [DATASETS.cocEdBoardKpis, DATASETS.cocEdFunderKpis]) assert.equal(kpi(rows, 'Exits to permanent housing (SPM 7b.1)').value, `${share('FY2026')}%`);
  assert.deepEqual([spm('SPM 7b.1: exits to permanent housing').FY2025, spm('SPM 7b.1: exits to permanent housing').FY2026], [`${share('FY2025')}%`, `${share('FY2026')}%`]);
  const bars = DATASETS.cocEdExitDestinations;
  assert.equal(bars.reduce((a, r) => a + r.value, 0), leavers.FY2026.length);
  assert.equal(bars.filter(r => r.group === 'Permanent').reduce((a, r) => a + r.value, 0), housed(leavers.FY2026));
  for (const row of bars) assert.equal(row.value, leavers.FY2026.filter(s => s.destination === row.label).length, row.label);
  assert.ok(tileText(board, `${comma(housed(leavers.FY2026))} of ${comma(leavers.FY2026.length)} leavers went to permanent housing`), 'bar title');
  assert.ok(tileText(board, `FY2026: ${share('FY2026')}% of leavers went to permanent housing`), 'KPI title');
  for (const row of DATASETS.cocEdEquity.filter(r => r.facet.startsWith('Exits'))) {
    const mine = leavers.FY2026.filter(s => raceGroup(s.person_id) === row.label);
    assert.ok(mine.length >= 20, row.label);
    assert.equal(row.value.toFixed(1), pct(housed(mine), mine.length), row.label);
  }
  // The equity title: Black clients exit to housing least and return most of the groups shown.
  const facet = (prefix) => DATASETS.cocEdEquity.filter(r => r.facet.startsWith(prefix));
  assert.equal(facet('Exits').reduce((lo, r) => (r.value < lo.value ? r : lo)).label, 'Black');
  assert.equal(facet('Returned').reduce((hi, r) => (r.value > hi.value ? r : hi)).label, 'Black');
  assert.ok(tileText(board, 'By race: Black clients exit to housing least and return most'));
  const unknown = leavers.FY2026.filter(s => s.destination === 'DK / refused' || s.destination === 'Not collected').length;
  const note = tileText(board, 'What the measures say').tileOptions.body;
  const g = (name) => leavers.FY2026.filter(s => raceGroup(s.person_id) === name);
  assert.ok(note.includes(`exited to housing at ${pct(housed(g('Black')), g('Black').length)}% vs ${pct(housed(g('White')), g('White').length)}%`));
  assert.ok(note.includes(`${Math.round((100 * unknown) / leavers.FY2026.length)}% of exit destinations are unknown`));
  const funderNote = tileText(funder, 'What the measures say').tileOptions.body;
  assert.ok(funderNote.includes(`rose from ${share('FY2025')}% to ${share('FY2026')}%`));
  console.log('# Measure 7b.1', JSON.stringify({ FY2025: { housed: housed(leavers.FY2025), leavers: leavers.FY2025.length, share: share('FY2025') }, FY2026: { housed: housed(leavers.FY2026), leavers: leavers.FY2026.length, share: share('FY2026') } }));
});

// ── The rest of the SPM table and the funder report ─────────────────────
test('Measures 3.1, 3.2, 4, 7a and 7b.2 recomputed from the microdata equal the packet tiles', () => {
  const m4 = {};
  for (const fy of ['FY2025', 'FY2026']) {
    const { from, to, pit } = YEARS[fy];
    const on = s => s.in <= pit && (s.out == null || s.out > pit);
    const inside = new Set(stays.filter(s => ['ES', 'SH', 'TH'].includes(s.project_type) && on(s)).map(s => s.person_id));
    const outside = new Set(stays.filter(s => s.project_type === 'SO' && on(s) && !inside.has(s.person_id)).map(s => s.person_id));
    assert.equal(spm('SPM 3.1: PIT night, HMIS-based')[fy], comma(inside.size + outside.size), `3.1 ${fy}`);
    assert.equal(spm('SPM 3.2: annual count, ES/SH/TH')[fy], comma(m1th[fy].size), `3.2 ${fy}`);
    const so = leaversOf(fy, ['SO']).filter(s => s.destination !== 'Deceased');
    assert.equal(spm('SPM 7a: outreach exits to a stable place')[fy], `${pct(so.filter(s => !['Place not meant for habitation', 'DK / refused', 'Not collected'].includes(s.destination)).length, so.length)}%`, `7a ${fy}`);
    const psh = new Map();
    for (const s of stays) if (s.project_type === 'PSH' && s.in < to && (s.out == null || s.out >= from)) psh.set(s.person_id, s);
    const pool = [...psh.values()].filter(s => !(s.out != null && s.out < to && s.destination === 'Deceased'));
    assert.equal(spm('SPM 7b.2: stayed in or left PSH for housing')[fy], `${pct(pool.filter(s => s.out == null || s.out >= to || PERMANENT.has(s.destination)).length, pool.length)}%`, `7b.2 ${fy}`);
    // Measure 4: adults in TH/RRH/PSH; stayers entry vs latest update in the year, leavers entry vs exit.
    const assessments = new Map();
    for (const a of income) { if (!assessments.has(a.enrollment_id)) assessments.set(a.enrollment_id, []); assessments.get(a.enrollment_id).push(a); }
    const cells = { stayers: { n: 0, earned: 0, other: 0, total: 0 }, leavers: { n: 0, earned: 0, other: 0, total: 0 } };
    const done = { stayers: new Set(), leavers: new Set() };
    for (const s of [...stays].reverse()) {
      if (!['TH', 'RRH', 'PSH'].includes(s.project_type) || person.get(s.person_id).age_band === 'Under 18') continue;
      const list = assessments.get(s.enrollment_id) ?? [];
      const start = list.find(a => a.assessment_point === 'entry');
      if (!start) continue;
      const leaving = s.out != null && s.out >= from && s.out < to, staying = s.in < to && (s.out == null || s.out >= to);
      const kind = leaving ? 'leavers' : staying ? 'stayers' : null;
      const later = leaving ? list.find(a => a.assessment_point === 'exit') : staying ? list.filter(a => a.assessment_point === 'update' && ms(a.assessment_date) >= from && ms(a.assessment_date) < to).at(-1) : null;
      if (!kind || !later || done[kind].has(s.person_id)) continue;
      done[kind].add(s.person_id);
      const c = cells[kind]; c.n++;
      if (later.earned_income > start.earned_income) c.earned++;
      if (later.non_employment_cash_income > start.non_employment_cash_income) c.other++;
      if (later.total_income > start.total_income) c.total++;
    }
    const cell = (who, key) => `${pct(cells[who][key], cells[who].n)}% (${comma(cells[who][key])} of ${comma(cells[who].n)})`;
    const expected = [['stayers', 'earned'], ['stayers', 'other'], ['stayers', 'total'], ['leavers', 'earned'], ['leavers', 'other'], ['leavers', 'total']].map(([w, k]) => cell(w, k));
    assert.deepEqual(DATASETS.cocEdIncomeTable.map(r => r[fy]), expected, `SPM 4 ${fy}`);
    m4[fy] = cells;
  }
  // The funder report's note states the SPM 4 figures in words.
  const share = (fy, who, key) => pct(m4[fy][who][key], m4[fy][who].n);
  const note = tileText(funder, 'What the measures say').tileOptions.body;
  assert.ok(note.includes(`${share('FY2026', 'leavers', 'total')}% of adult leavers left with more total income than at entry (${share('FY2025', 'leavers', 'total')}% in FY2025)`));
  assert.ok(note.includes(`${share('FY2026', 'stayers', 'total')}% of stayers gained (${share('FY2025', 'stayers', 'total')}%)`));
  assert.ok(note.includes(`benefits (${share('FY2026', 'stayers', 'other')}%) than wages (${share('FY2026', 'stayers', 'earned')}%)`));
  assert.ok(note.includes(`wages (${share('FY2026', 'leavers', 'earned')}%) than benefits (${share('FY2026', 'leavers', 'other')}%)`));
  assert.ok(+share('FY2026', 'stayers', 'other') > +share('FY2026', 'stayers', 'earned') && +share('FY2026', 'leavers', 'earned') > +share('FY2026', 'leavers', 'other'), 'income table title holds');
});

// ── The definitions land verbatim; Measure 6 named not applicable ───────
test('both packets carry every approved definition with its SPM number; Measure 4 appears only in the funder report', async () => {
  const { COC_EDITION_DEFINITIONS, COC_EDITION_M6 } = await import('../src/templates.js');
  assert.deepEqual(COC_EDITION_DEFINITIONS.map(d => d.spm), ['SPM Measure 1a, 1b', 'SPM Measure 2', 'SPM Measure 3.1, 3.2', 'SPM Measure 4.1–4.6', 'SPM Measure 5.1, 5.2', 'SPM Measure 7a, 7b']);
  for (const tpl of [board, funder]) {
    const last = [...tpl.tiles].sort((a, b) => a.y - b.y || a.x - b.x).at(-1);
    assert.equal(last.type, 'text', tpl.id);
    for (const d of COC_EDITION_DEFINITIONS) {
      assert.ok(last.tileOptions.body.includes(d.text), `${tpl.id}: ${d.spm} verbatim`);
      assert.ok(last.tileOptions.body.includes(`${d.spm} — ${d.name}`), `${tpl.id}: ${d.spm} named`);
    }
    // The honesty lines are inside the texts and are never trimmed.
    for (const line of ['A return is a system result, not a personal failure', 'The two numbers answer different questions and are never interchangeable', 'with no record of homelessness in this system in the previous two years']) {
      assert.ok(COC_EDITION_DEFINITIONS.some(d => d.text.includes(line)), line);
      assert.ok(last.tileOptions.body.includes(line), `${tpl.id}: ${line}`);
    }
    assert.ok(last.tileOptions.body.includes(`SPM Measure 6 — Not applicable\n${COC_EDITION_M6}`), `${tpl.id}: Measure 6`);
  }
  // The approved Measure 2 text has no HMIS-only line (the draft keeps it in the spec anchor), so the packet says it in its note.
  assert.ok(tileText(board, 'What the measures say').tileOptions.body.includes('SPM 2 counts only returns recorded in Meridian\'s HMIS'));
  assert.ok(!board.tiles.some(t => t.dataset === 'cocEdIncomeTable' || /SPM 4/.test(t.title)), 'no Measure 4 tile in the board packet');
  assert.ok(!DATASETS.cocEdBoardKpis.some(r => /SPM 4/.test(r.label)) && !DATASETS.cocEdSpmTable.some(r => /SPM 4/.test(r.measure)), 'no Measure 4 figure in the board packet');
  assert.ok(funder.tiles.some(t => t.dataset === 'cocEdIncomeTable'), 'the six-cell table lives in the funder report');
});
