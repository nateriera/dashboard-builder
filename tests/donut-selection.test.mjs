import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document; globalThis.window = dom.window;
for (const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','getComputedStyle']) globalThis[key] = dom.window[key];
const { donutChart } = await import('../src/charts/charts.js');
const { renderData, donutParts } = await import('../src/charts/integrity.js');
const { validateFilters, applyFilters } = await import('../src/data/filters.js');
const { LIMITS } = await import('../src/data/limits.js');
const { validateLayout } = await import('../src/data/layout.js');

function selections(rows) {
  const chart = donutChart(rows,{label:'label',value:'value',crossfilterField:'label'});
  return [...chart.querySelectorAll('a')].map(mark=>({
    label:mark.getAttribute('aria-label'),
    values:JSON.parse(decodeURIComponent(mark.getAttribute('href').slice('#db-crossfilter:'.length)))
  }));
}

test('pre-grouped donut remainder carries its constituent categories through the chart grouping pass', () => {
  const rows = 'ABCDEFGHI'.split('').map((label,index)=>({label,value:9-index}));
  const before = structuredClone(rows);
  const marks = selections(renderData('donut',rows).rows);
  assert.deepEqual(marks.find(mark=>mark.label.includes('Other')).values,['F','G','H','I']);
  assert.deepEqual(marks.find(mark=>mark.label==='Category: A').values,['A']);
  assert.deepEqual(rows,before);
});

test('donut grouping preserves null and colliding display labels as their actual source values', () => {
  const marks = selections(donutParts([{label:null,value:3},{label:'Unlabeled',value:2},{label:'',value:1}]));
  assert.deepEqual(marks.find(mark=>mark.label==='Category: Unlabeled').values,[null,'Unlabeled']);
  assert.deepEqual(marks.find(mark=>mark.label==='Category: ').values,['']);
});

test('donut remainder avoids a real category named Other while preserving exact membership', () => {
  const rows = [{label:'Other (remaining categories)',value:100},...'ABCDEFG'.split('').map((label,index)=>({label,value:8-index}))];
  const marks = selections(renderData('donut',rows).rows);
  assert.deepEqual(marks.find(mark=>mark.label==='Category: Other (remaining categories)').values,['Other (remaining categories)']);
  assert.deepEqual(marks.find(mark=>mark.label.includes('— grouped')).values,['E','F','G']);
});

test('donut remainders with more than 200 folded categories remain valid bounded crossfilters', () => {
  const rows=Array.from({length:211},(_,index)=>({label:`Category ${String(index).padStart(3,'0')}`,value:211-index}));
  const values=selections(renderData('donut',rows).rows).find(mark=>mark.label.includes('Other')).values;
  assert.equal(values.length,206);
  const selection={id:'remainder',field:'label',op:'is',values,source:'crossfilter',sourceTile:'donut'};
  const filters=validateFilters([selection]);
  assert.deepEqual(applyFilters(rows,filters,{sourceTile:'target'}).rows,rows.slice(5));
  const layout=validateLayout({app:'dashboard-builder',version:1,tiles:[{type:'donut',dataset:'categorical',drillValues:values}],filters});
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))).tiles[0].drillValues,values);
  assert.throws(()=>validateFilters([{...selection,values:Array(LIMITS.rows+1).fill('A')}]));
  assert.throws(()=>validateFilters([{id:'manual',field:'label',op:'is',values:Array(201).fill('A')}]));
  const typed=[{label:1},{label:'1'},{label:-0},{label:0},{label:null}];
  assert.deepEqual(applyFilters(typed,[{...selection,values:[1,-0,null]}],{sourceTile:'target'}).rows,[typed[0],typed[2],typed[4]]);
});

// ── Donut fit: stacked vs side-by-side layout ───────────────────────────────
const { donutLayout } = await import('../src/charts/charts.js');
const fitRows = [{label:'A',value:5},{label:'B',value:3},{label:'C',value:2}];

test('donut layout: callers that give no available space get the stacked sizing unchanged', () => {
  // Stacked: min(width, height - 80, 400), floor 80 — the pre-fit formula.
  assert.deepEqual(donutLayout({ width: 400, height: 196 }), { side: false, width: 116 });
  assert.deepEqual(donutLayout({ width: 300, height: 900 }), { side: false, width: 300 });
  assert.deepEqual(donutLayout({ width: 900, height: 900 }), { side: false, width: 400 });
  assert.deepEqual(donutLayout({ width: 120, height: 120 }), { side: false, width: 80 });
  const chart = donutChart(fitRows, { label: 'label', value: 'value', width: 400, height: 196 });
  assert.equal(chart.className.trim(), 'db-donut');
  assert.equal(chart.querySelector('svg').getAttribute('width'), '116');
  assert.equal(chart.querySelector('svg').getAttribute('viewBox'), '0 0 348 348');
});

test('donut layout: a clearly wide space puts the legend beside a full-height ring', () => {
  // 529 wide × 226 tall: 529 >= 1.3 × 226, and 529 - 24 - 150 = 355 leaves room → ring = the height.
  assert.deepEqual(donutLayout({ width: 400, height: 196, availableWidth: 529, availableHeight: 226 }), { side: true, width: 226 });
  // The ring never takes the legend's minimum column: 300 - 24 - 150 = 126.
  assert.deepEqual(donutLayout({ width: 300, height: 140, availableWidth: 300, availableHeight: 200 }), { side: true, width: 126 });
  // Capped at 400 like the stacked ring.
  assert.deepEqual(donutLayout({ width: 400, height: 500, availableWidth: 1200, availableHeight: 600 }), { side: true, width: 400 });
  const chart = donutChart(fitRows, { label: 'label', value: 'value', width: 400, height: 196, availableWidth: 529, availableHeight: 226, crossfilterField: 'label' });
  assert.ok(chart.classList.contains('db-donut-side'));
  assert.ok(chart.querySelector('.db-legend').classList.contains('db-legend-side'));
  assert.equal(chart.querySelector('svg').getAttribute('width'), '226');
  assert.equal(chart.querySelectorAll('a[href^="#db-crossfilter:"]').length, 3, 'slices stay selectable beside the legend');
  assert.equal(chart.querySelectorAll('text[pointer-events="none"]').length, 2, 'centre labels still let pointer events through');
  // The centre total keeps the existing scaling: min(22, max(12, width / 15)) rendered px.
  const svgEl = chart.querySelector('svg'), size = Number(svgEl.getAttribute('viewBox').split(' ')[2]);
  const rendered = Number(chart.querySelector('text').getAttribute('font-size')) * 226 / size;
  assert.ok(Math.abs(rendered - 226 / 15) < 0.01, `total renders at ${rendered}px`);
});

test('donut layout: square, tall or cramped spaces stay stacked', () => {
  assert.equal(donutLayout({ width: 300, height: 220, availableWidth: 300, availableHeight: 300 }).side, false, 'square');
  assert.equal(donutLayout({ width: 300, height: 520, availableWidth: 300, availableHeight: 600 }).side, false, 'tall');
  assert.equal(donutLayout({ width: 360, height: 220, availableWidth: 360, availableHeight: 300 }).side, false, 'only 1.2× wider than tall');
  assert.equal(donutLayout({ width: 250, height: 100, availableWidth: 250, availableHeight: 150 }).side, false, 'no room for a 96px ring beside a 150px legend');
  assert.equal(donutLayout({ width: 400, height: 60, availableWidth: 600, availableHeight: 90 }).side, false, 'under 96px tall');
  // Narrow stacked legends: compact under 280px, figure under its label under 190px.
  const legendClass = w => donutChart(fitRows, { label: 'label', value: 'value', width: w, height: 700 }).querySelector('.db-legend').className.trim().split(/\s+/).join(' ');
  assert.equal(legendClass(300), 'db-legend');
  assert.equal(legendClass(240), 'db-legend db-legend-compact');
  assert.equal(legendClass(120), 'db-legend db-legend-compact db-legend-narrow');
});
