import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
const dom = new JSDOM('<!doctype html><body></body>',{ url: 'https://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document; globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
for (const k of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','CustomEvent','getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
for (const k of ['IDBDatabase','IDBRequest','IDBTransaction','IDBObjectStore','IDBIndex','IDBCursor']) globalThis[k] = (await import('fake-indexeddb'))[k];
const { TILE_TYPES, DATASETS } = await import('../src/tiles/registry.js');
const { donutParts, renderData } = await import('../src/charts/integrity.js');
const { numericExtent, LIMITS } = await import('../src/data/limits.js');
const { normalizeRows } = await import('../src/tiles/normalize.js');
const { sanitizeValue, materializeResult } = await import('../src/data/sql.js');
const { validateLayout, assertNoCollisions } = await import('../src/data/layout.js');
const { migrateLegacy } = await import('../src/data/migrate.js');
const { createQueryCoordinator, createPreviewGate } = await import('../src/data/queryCoordinator.js');
const { parseFile } = await import('../src/data/parse.js');
const store = await import('../src/data/store.js');
const layout = (dataset = 'categorical') => ({ app: 'dashboard-builder', version: 1, defaultDataset: {kind:'dataset',ref:'upload:revenue'}, tiles: [{id:'bar1',type:'bar',dataset,x:0,y:0,w:6,h:5}] });
const total = rows => rows.reduce((s,r)=>s+r.value,0);

test('R1: all eight donut categories total 48,240, independent of row order', () => {
  for (const rows of [DATASETS.categorical,[...DATASETS.categorical].reverse()]) {
    const parts = donutParts(rows); assert.equal(total(parts),48240); assert.equal(parts.length,6);
    const el = document.createElement('div'); TILE_TYPES.donut.render(el,{data:rows,options:{title:'Share'}});
    assert.match(el.textContent,/48,240/); assert.match(el.textContent,/Other/);
  }
  assert.deepEqual(donutParts([{label:'a',value:3},{label:'a',value:2}]),[{label:'a',value:5}]);
  for (const v of [-1,0,null]) assert.throws(()=>donutParts([{label:'a',value:v}]));
});
test('R1: neutral units and default zero-inclusive shared domain through registry', async () => {
  const el = document.createElement('div');
  TILE_TYPES.bar.render(el,{data:[{label:'Revenue',value:10}],options:{}});
  assert.doesNotMatch(el.textContent,/Requests|Rent burden|Rate per/);
  TILE_TYPES.bar.render(el,{data:[{label:'Revenue',value:10}],options:{tileOptions:{xLabel:'USD'}}});
  assert.match(el.textContent,/USD/);
  const { smallMultiples } = await import('../src/charts/charts.js');
  const domains=[]; smallMultiples([{facet:'a',value:10},{facet:'b',value:20}],{facet:'facet',value:'value',chart:(_,o)=>{ domains.push(o.yDomain); return document.createElement('div'); }});
  assert.deepEqual(domains,[[0,20],[0,20]]);
});
test('R3: every binding survives migration, reload and JSON without input mutation', () => {
  for (const dataset of ['categorical','upload:u1','query:q1',null]) {
    const original = layout(dataset), raw = JSON.stringify(original);
    const v2 = validateLayout(original), roundTrip = validateLayout(JSON.parse(JSON.stringify(v2)));
    assert.equal(JSON.stringify(original),raw); assert.equal(roundTrip.tiles[0].dataset,dataset);
    assert.deepEqual(roundTrip.tiles[0].binding,dataset === null ? {mode:'dashboard'} : {mode:'explicit',ref:dataset});
    assert.equal(roundTrip.version,3);
  }
});
test('R7: malformed envelopes fail validation before any mutation', () => {
  const changes = [l=>l.version=99,l=>l.tiles[0].type='constructor',l=>l.tiles.push({...l.tiles[0]}),l=>l.tiles[0].x=Infinity,l=>l.tiles[0].w=13,l=>l.datasets={u:{rows:[{a:{nested:true}}]}},l=>l.queries={q:{sql:'SELECT 1',columns:['a'],mapping:{value:'missing'}}}];
  for (const change of changes) { const l=layout(); change(l); assert.throws(()=>validateLayout(l)); }
  const candidate=validateLayout({...layout('upload:u'),datasets:{u:{name:'new',rows:[{label:'a',value:2}],columns:['label','value']}}});
  assert.throws(()=>assertNoCollisions(candidate,()=>({name:'old',rows:[{value:1}]}),()=>null),/Conflicting/);
});
test('R8: exact integers survive SQL, JSON, store and KPI; plotting refuses approximation', async () => {
  for (const n of [9007199254740991n,9007199254740992n,9007199254740993n,-9007199254740993n]) {
    const exact=sanitizeValue(n,'Int64'); assert.equal(String(exact),String(n));
    const rows=normalizeRows(TILE_TYPES.kpi,[{label:'Exact',value:exact}],{label:'label',value:'value'}).rows;
    const {id}=store.saveDataset({name:'Exact',columns:['label','value'],rows,fieldKeys:[],mapping:{}});
    assert.equal(await store.persistDataset(id),true); assert.equal(JSON.parse(JSON.stringify(store.getDataset(id))).rows[0].value,String(n));
    const el=document.createElement('div'); TILE_TYPES.kpi.render(el,{data:rows,options:{}}); assert.match(el.textContent,new RegExp(String(n)));
    if (n > 9007199254740991n || n < -9007199254740991n) assert.throws(()=>normalizeRows(TILE_TYPES.bar,[{label:'a',value:exact}],{label:'label',value:'value'}),/Precision/);
  }
  assert.equal(normalizeRows(TILE_TYPES.bar,[{value:'1e309'}],{value:'value'}).dropped,1);
});
test('R8: millisecond timestamp boundaries and timezone offsets are explicit; finer precision is refused', () => {
  assert.equal(sanitizeValue(Date.parse('2026-10-01T12:30:00.123Z'),'TimestampMillisecond'),'2026-10-01T12:30:00.123Z');
  assert.equal(sanitizeValue(Date.parse('2026-10-01T05:30:00.123-07:00'),'TimestampMillisecond'),'2026-10-01T12:30:00.123Z');
  assert.throws(()=>sanitizeValue(1000.123,'TimestampMicrosecond'),/Sub-millisecond/);
  assert.throws(()=>sanitizeValue(new Uint32Array([1,2]),'Decimal'),/decimals/);
});
test('R5: unavailable, quota, partial writes and read-back faults retain recoverable source across reload', async () => {
  const source=JSON.stringify({a:{rows:[{v:1}]},b:{rows:[{v:2}]}});
  for (const mode of ['unavailable','quota','partial','readback','success']) {
    const storage=new Map([['old',source]]), durable=new Map(), records=new Map();
    const adapter={getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)};
    const db=mode==='unavailable'?null:{get:async(_,id)=>mode==='readback'?undefined:durable.get(id),put:async(_,e)=>{if(mode==='quota'||(mode==='partial'&&e.id==='b'))throw new Error('quota'); durable.set(e.id,e);}};
    const ingest=(id,e,p)=>records.set(id,{...e,persisted:p});
    const failures=await migrateLegacy({storage:adapter,keys:['old'],db,ingest});
    assert.equal(storage.has('old'),mode!=='success');
    if (mode!=='success') {
      assert.equal(JSON.parse(storage.get('old')).b.rows[0].v,2); assert.ok(failures.length);
      const reload=new Map(); await migrateLegacy({storage:adapter,keys:['old'],db:null,ingest:(id,e)=>reload.set(id,e)}); assert.equal(reload.size,2);
    } else assert.equal(failures.length,0);
  }
  const corrupt={getItem:()=>'{bad',removeItem:()=>assert.fail('Corrupt source must be retained')};
  assert.equal((await migrateLegacy({storage:corrupt,keys:['old'],db:null,ingest:()=>{}})).length,1);
});
test('R7: partial IndexedDB import transaction aborts without publishing records', async () => {
  const { openDB } = await import('idb'); const db=await openDB('dashbuilder',1);
  await db.put('datasets',{id:'collision',rows:[]});
  await assert.rejects(store.restoreDatasets({staged:{rows:[{value:1}]},collision:{rows:[]}}));
  assert.equal(store.hasDataset('staged'),false); assert.equal(await db.get('datasets','staged'),undefined);
  db.close();
});
test('R4: deferred previews cannot apply SQL A after editing to B or a dataset revision', () => {
  let revision=1; const gate=createPreviewGate(()=>revision);
  const a=gate.begin('A'); gate.invalidate(); assert.equal(gate.accept(a,'B'),false); assert.equal(gate.eligible('B'),false);
  const b=gate.begin('B'); assert.equal(gate.accept(b,'B'),true); assert.equal(gate.eligible('B'),true);
  revision++; assert.equal(gate.eligible('B'),false);
  const c=gate.begin('C'); gate.invalidate(); assert.equal(gate.accept(c,'C'),false);
});
test('R4: revisions synchronize serially and superseded query results are rejected', async () => {
  let rev=1, release, syncCount=0, concurrent=0, max=0;
  const coordinator=createQueryCoordinator({revision:()=>rev,collect:()=>rev,sync:async()=>{concurrent++;max=Math.max(max,concurrent);syncCount++;await new Promise(r=>setTimeout(r,5));concurrent--;},execute:async()=>{await new Promise(r=>release=r);return {rows:[{value:1}]};}});
  const pending=coordinator.run('A');
  while(!release) await new Promise(r=>setTimeout(r,1));
  rev++; const newer=coordinator.ensure(); release();
  await assert.rejects(pending,/Datasets changed/); await newer;
  assert.equal(syncCount,2); assert.equal(max,1);
});
test('R6: 250,000-row fixtures have safe domains and bounded plotted marks', () => {
  const rows=Array.from({length:250000},(_,i)=>({x:i,y:i,value:i,date:i}));
  assert.deepEqual(numericExtent(rows.map(r=>r.value)),[0,249999]); assert.deepEqual(numericExtent([null,NaN]),[0,1]);
  const prepared=renderData('scatter',rows); assert.equal(prepared.rows.length,LIMITS.marks); assert.match(prepared.note,/250,000/); assert.equal(prepared.rows.at(-1).x,249999);
  const el=document.createElement('div'); TILE_TYPES.scatter.render(el,{data:rows,options:{tileOptions:{trend:true}}}); assert.ok(el.querySelector('svg'));
  assert.throws(()=>renderData('smallMultiples',Array.from({length:13},(_,i)=>({facet:i}))),/Facet limit/);
  assert.throws(()=>parseFile('a.csv','a\n'+'x'.repeat(LIMITS.fileBytes)),/16 MiB/);
  assert.throws(()=>parseFile('a.json',JSON.stringify([Object.fromEntries(Array.from({length:101},(_,i)=>['c'+i,i]))])),/Column/);
  assert.throws(()=>materializeResult({numRows:LIMITS.queryRows+1}),/result limit/);
});
test('R2/R6: upload row boundaries and oversized dependency reasons are explicit', () => {
  const csv='label,value\n'+'a,1\n'.repeat(LIMITS.rows);
  assert.equal(parseFile('maximum.csv',csv).rows.length,LIMITS.rows);
  assert.throws(()=>parseFile('oversized.csv',csv+'a,1\n'),/Too many rows/);
  const {id}=store.saveDataset({name:'Oversized input',columns:['value'],rows:[{value:'x'.repeat(512*1024)}],fieldKeys:[],mapping:{}});
  const {inlined,skipped}=store.inlineDatasets([`upload:${id}`,'upload:missing']);
  assert.equal(Object.keys(inlined).length,0); assert.match(skipped[0],/Oversized input.*exceeds/); assert.match(skipped[1],/missing/);
});

 test('V3 geometry: legacy pixel positions and manual intent round-trip exactly', () => {
  for (const version of [1,2]) {
    const old = { ...layout(), version, tiles: [{...layout().tiles[0],y:900,h:1000,binding:{mode:'explicit',ref:'categorical'}}] };
    const next=validateLayout(old);
    assert.equal(next.rowHeight,24); assert.equal(next.tiles[0].y*24,900*72); assert.equal(next.tiles[0].h*24,1000*72);
    assert.equal(next.tiles[0].sizing,'manual'); assert.deepEqual(validateLayout(next),next);
  }
  const auto=validateLayout(layout()); auto.tiles[0].sizing='auto'; assert.equal(validateLayout(auto).tiles[0].sizing,'auto');
  assert.throws(()=>validateLayout({...auto,rowHeight:72}));
 });
 test('Content fit uses inset margins once and facets adapt without horizontal overflow', async () => {
   const {rowsForContent,facetColumns}=await import('../src/tiles/geometry.js');
   assert.equal(rowsForContent(336,24,12),15);
   assert.deepEqual([220,480,800].map(w=>facetColumns(w,3)),[1,2,3]);
   const el=document.createElement('div'); Object.defineProperty(el,'clientWidth',{value:320}); Object.defineProperty(el,'clientHeight',{value:500});
   TILE_TYPES.smallMultiples.render(el,{data:DATASETS.facets,options:{sizing:'manual'}});
   assert.equal(el.querySelector('.db-facets').style.gridTemplateColumns,'repeat(1, minmax(0, 1fr))');
   for (const svg of el.querySelectorAll('.db-facet svg')) assert.ok(+svg.getAttribute('width')<=288);
 });

test('default tile titles avoid collisions while explicit titles stay unchanged', async () => {
  const { resolveTileTitle } = await import('../src/tiles/titles.js');
  const used = ['Requests by category'];
  const bar = resolveTileTitle(null, 'Requests by category', used);
  assert.equal(bar, 'Requests by category 2');
  const dot = resolveTileTitle(null, 'Requests by category', [...used, bar]);
  assert.equal(dot, 'Requests by category 3');
  assert.equal(resolveTileTitle('Monthly volume', 'Requests by category', [...used, bar]), 'Monthly volume');
});
