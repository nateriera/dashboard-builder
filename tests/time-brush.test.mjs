import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { timeMarkRender, timeBrushPoints, timeBrushSelection } from '../src/charts/timeMarks.js';
import { retainSourceRows, sourceRowsFor } from '../src/data/rowProvenance.js';
import { validateFilters, applyFilters } from '../src/data/filters.js';
import { LIMITS } from '../src/data/limits.js';

test('time marks retain actual filtered Plot indexes and original-row provenance', () => {
  const doc=new JSDOM('<svg><g aria-label="dot"></g></svg>').window.document;
  const source=[{date:'Original A'},{date:'Original missing'},{date:'Original C'}];
  const rows=retainSourceRows([{date:'2026-01-01',value:1},{date:'2026-01-02',value:null},{date:'2026-01-03',value:3}],source);
  const plotted=rows.map(row=>({...row,date:new Date(`${row.date}T00:00:00`)}));
  const next=()=>{const group=doc.querySelector('g');for(const x of [30,10]){const circle=doc.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx',x);group.append(circle);}return group;};
  timeMarkRender(plotted,rows)([2,0],{}, {},{}, {},next);
  const points=timeBrushPoints(doc.querySelector('svg'));
  assert.deepEqual(points.map(point=>point.row),[rows[0],rows[2]]);
  assert.deepEqual(points.map(point=>point.time),[plotted[0].date.getTime(),plotted[2].date.getTime()]);
  assert.deepEqual(sourceRowsFor(points.map(point=>point.row)),[source[0],source[2]]);
});

test('brush membership includes only linked visible marks within the actual pixel interval', () => {
  const points=[{x:10,row:{date:'2026-01-01'}},{x:20,row:{date:'2026-01-03'}},{x:30,row:{date:'2026-01-05'}}];
  assert.deepEqual(timeBrushSelection(points,31,19),{values:['2026-01-03','2026-01-05'],markValues:['2026-01-03','2026-01-05']});
  assert.equal(timeBrushSelection(points,11,19),null);
});

const selection={id:'brush',field:'date',op:'date-between',values:['2026-01-01','2026-01-05'],source:'crossfilter',sourceTile:'line',markValues:['2026-01-01','2026-01-05']};
test('sampled brush membership survives validation/serialization and excludes hidden intervening records', () => {
  const input=structuredClone(selection);
  const filters=validateFilters(JSON.parse(JSON.stringify([input])));
  assert.deepEqual(filters,[selection]);
  const rows=[{date:'2026-01-01'},{date:'2026-01-02'},{date:'2026-01-05'}];
  assert.deepEqual(applyFilters(rows,filters,{sourceTile:'target'}).rows,[rows[0],rows[2]]);
  assert.equal(applyFilters(rows,filters,{sourceTile:'line'}).rows,rows);
  assert.deepEqual(input,selection);
});

test('brush membership validates its source, dates and unchanged display-cap bound', () => {
  for(const patch of [{markValues:[]},{markValues:['invalid']},{source:undefined,sourceTile:undefined},{op:'is'},{markValues:Array(LIMITS.marks+1).fill('2026-01-01')}]) assert.throws(()=>validateFilters([{...selection,...patch}]));
  const full=validateFilters([{...selection,markValues:Array(LIMITS.marks).fill('2026-01-01')}]);
  assert.equal(full[0].markValues.length,LIMITS.marks);
});
