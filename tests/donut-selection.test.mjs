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
