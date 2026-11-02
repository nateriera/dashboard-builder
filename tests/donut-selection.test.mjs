import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document; globalThis.window = dom.window;
for (const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','getComputedStyle']) globalThis[key] = dom.window[key];
const { donutChart } = await import('../src/charts/charts.js');
const { renderData, donutParts } = await import('../src/charts/integrity.js');

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
