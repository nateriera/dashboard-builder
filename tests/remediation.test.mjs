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
const { validateFilters, applyFilters, distinctValues, filterFieldType, sortAndLimitRows } = await import('../src/data/filters.js');
const { validateParameters, substituteParameters } = await import('../src/data/parameters.js');
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

test('Phase 1: dynamic table preserves source columns and reports its 500-row cap', () => {
  const rows = Array.from({length: LIMITS.tableRows + 1}, (_, i) => ({'Record ID': String(i), amount: i + 0.25, active: i % 2 === 0}));
  const normalized = normalizeRows(TILE_TYPES.table, rows, {}).rows;
  assert.deepEqual(normalized[0], rows[0]);
  assert.equal(normalized[0]['Record ID'], '0');
  const prepared = renderData('table', normalized);
  assert.equal(prepared.rows.length, 500);
  assert.match(prepared.note, /showing first 500 of 501/i);
  const el = document.createElement('div');
  TILE_TYPES.table.render(el, {data: prepared.rows, options:{}});
  assert.deepEqual([...el.querySelectorAll('thead th')].map(th => th.textContent), ['Record ID','amount','active']);
  assert.equal(el.querySelectorAll('tbody tr').length, 500);
});

test('Phase 1: annotation has no data binding and renders plain text safely through layout round-trip', () => {
  const candidate = validateLayout({app:'dashboard-builder',version:3,rowHeight:24,tiles:[{
    id:'note',type:'text',dataset:null,binding:{mode:'none'},tileOptions:{body:'Methodology\n<script>window.pwned=true</script>'},x:0,y:0,w:12,h:6
  }]});
  assert.deepEqual(candidate.tiles[0].binding,{mode:'none'});
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(candidate))).tiles[0].tileOptions,{body:'Methodology\n<script>window.pwned=true</script>'});
  assert.throws(()=>validateLayout({...candidate,tiles:[{...candidate.tiles[0],dataset:'categorical',binding:{mode:'explicit',ref:'categorical'}}]}),/no data|binding/i);
  const el=document.createElement('div');
  TILE_TYPES.text.render(el,{data:[],options:{tileOptions:{body:'Methodology\n<script>window.pwned=true</script>'}}});
  assert.equal(el.querySelector('.db-annotation').textContent,'Methodology\n<script>window.pwned=true</script>');
  assert.equal(el.querySelector('script'),null);
});

test('Phase 1: heatmap bounds distinct cells and rejects duplicate cell coordinates explicitly', () => {
  const rows=Array.from({length:LIMITS.heatmapCells+1},(_,i)=>({x:`x${i}`,y:'only',value:i}));
  assert.throws(()=>renderData('heatmap',rows),/2,000 distinct cells.*aggregate/i);
  assert.throws(()=>renderData('heatmap',[{x:'a',y:'b',value:1},{x:'a',y:'b',value:2}]),/duplicate.*aggregate/i);
  assert.equal(renderData('heatmap',[{x:'a',y:'b',value:1}]).rows.length,1);
  assert.throws(()=>renderData('heatmap',[{x:1,y:'b',value:1},{x:'1',y:'b',value:2}]),/duplicate/i);
  assert.throws(()=>renderData('treemap',[{label:'zero',value:0}]),/positive total/i);
});

test('Phase 1: new chart renderers produce visible marks across all themes and chart modes', async () => {
  const {setTheme,THEMES}=await import('../src/themes/themes.js');
  const load=(name)=>JSON.parse(readFileSync(new URL(`../src/data/${name}`,import.meta.url),'utf8'));
  const cases=[
    ['stackedBar','stacked.json',{mode:'stacked'}],['stackedBar','stacked.json',{mode:'grouped'}],
    ['stackedColumn','stacked.json',{mode:'stacked'}],['stackedColumn','stacked.json',{mode:'grouped'}],
    ['histogram','scatter.json',{binCount:20}],['boxplot','boxdata.json',{}],['area','timeseries.json',{}],
    ['heatmap','heatmap.json',{}],['treemap','treemap.json',{}]
  ];
  for(const theme of THEMES){
    setTheme(theme.id);
    for(const [type,file,tileOptions] of cases){
      const el=document.createElement('div');
      TILE_TYPES[type].render(el,{data:load(file),options:{title:type,tileOptions}});
      assert.ok(el.querySelector('svg'),`${theme.id}/${type}/${tileOptions.mode||'default'} should render SVG`);
    }
    const withoutSeries=load('timeseries.json').map(({series,...row})=>row);
    const area=document.createElement('div');TILE_TYPES.area.render(area,{data:withoutSeries,options:{tileOptions:{}}});assert.ok(area.querySelector('svg'),`${theme.id}/area without series`);
  }
  setTheme('paper');
  for(const type of ['histogram','area']){
    const dense=Array.from({length:LIMITS.marks+1},(_,i)=>({value:i,date:i,label:'x'}));
    const prepared=renderData(type,dense);assert.equal(prepared.rows.length,LIMITS.marks);assert.match(prepared.note,/2,000 evenly spaced rows/);
  }
  assert.throws(()=>renderData('boxplot',Array.from({length:101},(_,i)=>({label:`g${i}`,value:i}))),/100 categories/);
  const histLayout=validateLayout({app:'dashboard-builder',version:3,rowHeight:24,tiles:[{id:'hist',type:'histogram',dataset:'scatter',binding:{mode:'explicit',ref:'scatter'},tileOptions:{binCount:100},x:0,y:0,w:6,h:15}]});
  assert.equal(histLayout.tiles[0].tileOptions.binCount,100);
  assert.throws(()=>validateLayout({...histLayout,tiles:[{...histLayout.tiles[0],tileOptions:{binCount:101}}]}),/Unsupported chart option/);
});

test('Phase 2: categorical and numeric dashboard filters preserve absent-field tiles', () => {
  const rows=[
    {category:'Housing',amount:10},
    {category:'Food',amount:20},
    {category:'Housing',amount:30}
  ];
  assert.deepEqual(applyFilters(rows,[{id:'f1',field:'category',op:'is',values:['Housing']}]).rows,[rows[0],rows[2]]);
  assert.deepEqual(applyFilters(rows,[{id:'f1',field:'category',op:'is-not',values:['Housing']}]).rows,[rows[1]]);
  assert.deepEqual(applyFilters(rows,[{id:'f1',field:'amount',op:'between',values:[15,30]}]).rows,[rows[1],rows[2]]);
  const absent=applyFilters([{label:'A',value:1}],[{id:'f1',field:'category',op:'is',values:['Housing']}]);
  assert.equal(absent.applied,false);
  assert.deepEqual(absent.rows,[{label:'A',value:1}]);
  const self=applyFilters(rows,[{id:'cf',field:'category',op:'is',values:['Housing'],source:'crossfilter',sourceTile:'bar1'}],{sourceTile:'bar1'});
  assert.equal(self.applied,false);
  assert.deepEqual(self.rows,rows);
  assert.equal(filterFieldType(rows,'amount'),'number');
  assert.equal(filterFieldType([...DATASETS.categorical,...DATASETS.kpis],'value'),'number');
  assert.equal(filterFieldType([{fips:'01'},{fips:'06'}],'fips'),'category');
  assert.equal(filterFieldType([{date:'2025-01-01'},{date:'2025-02-01'}],'date'),'date');
});

test('Phase 2: filter validation and distinct-value caps are bounded', () => {
  assert.throws(()=>validateFilters([{id:'bad',field:'x',op:'between',values:[0]}]),/filter/i);
  assert.throws(()=>validateFilters([{id:'bad',field:'__proto__',op:'is',values:['x']}]),/filter/i);
  const values=distinctValues(Array.from({length:205},(_,i)=>({field:`v${i}`})),'field');
  assert.equal(values.values.length,200);
  assert.equal(values.truncated,true);
  assert.equal(distinctValues([{field:'a'},{field:'a'}],'field').truncated,false);
});

test('Phase 2: sort then top-N keeps whole categories and stacked groups', () => {
  const rows=[
    {label:'B',value:2},{label:'A',value:5},{label:'C',value:1},{label:'B',value:4}
  ];
  assert.deepEqual([...new Set(sortAndLimitRows('bar',rows,{sort:'desc',topN:2}).map(r=>r.label))],['B','A']);
  assert.deepEqual([...new Set(sortAndLimitRows('bar',rows,{sort:'asc',topN:2}).map(r=>r.label))],['C','A']);
  assert.deepEqual([...new Set(sortAndLimitRows('bar',rows,{sort:'data',topN:2}).map(r=>r.label))],['B','A']);
  const stacked=[{label:'A',series:'x',value:5},{label:'B',series:'x',value:4},{label:'B',series:'y',value:3},{label:'C',series:'x',value:1}];
  assert.deepEqual([...new Set(sortAndLimitRows('stackedBar',stacked,{topN:1}).map(r=>r.label))],['B']);
  assert.equal(sortAndLimitRows('bar',rows,{sort:'desc',topN:null}).length,rows.length);
});

test('Phase 2: SQL parameters validate names and substitute safe SQL literals', () => {
  const params=validateParameters([
    {name:'growth',type:'number',value:1.25,min:0,max:2},
    {name:'owner',type:'text',value:"O'Brien"}
  ]);
  assert.equal(substituteParameters("SELECT {{growth}}, {{owner}}",params),"SELECT 1.25, 'O''Brien'");
  assert.throws(()=>substituteParameters('SELECT {{missing}}',params),/unknown.*missing/i);
  assert.throws(()=>validateParameters([{name:'bad-name',type:'text',value:'x'}]),/parameter/i);
  assert.throws(()=>validateParameters([{name:'growth',type:'number',value:3,min:0,max:2}]),/parameter/i);
});

test('Phase 2: labeled reference lines render zero and negative values across chart types and themes', async () => {
  const {setTheme,THEMES}=await import('../src/themes/themes.js');
  const {referenceMarks}=await import('../src/charts/charts.js');
  const cases=[
    ['bar','categorical'],['column','categorical'],['dot','categorical'],
    ['line','timeseries'],['area','timeseries'],['scatter','scatter'],
    ['histogram','scatter'],['boxplot','boxdata']
  ];
  assert.deepEqual(referenceMarks('y',null,'Target'),[]);
  for(const theme of THEMES){
    setTheme(theme.id);
    for(const [type,dataset] of cases) for(const value of [0,-1]){
      const el=document.createElement('div');
      TILE_TYPES[type].render(el,{data:DATASETS[dataset],options:{title:type,tileOptions:{referenceValue:value,referenceLabel:'Target'}}});
      const svg=[...el.querySelectorAll('svg')].find(node=>node.textContent.includes('Target'))||el.querySelector('svg');
      assert.ok(svg,`${theme.id}/${type}/${value} should render`);
      assert.match(el.textContent,/Target/,`${theme.id}/${type}/${value} should label the reference line: ${el.innerHTML.slice(-1400)}`);
      assert.ok(el.querySelector('[stroke-dasharray], [style*="stroke-dasharray"]'),`${theme.id}/${type}/${value} should render a dashed rule: ${el.innerHTML.slice(-1200)}`);
    }
  }
  setTheme('paper');
});

test('Phase 2: filters and parameters persist through layout validation and JSON round-trip', () => {
  const input={app:'dashboard-builder',version:3,rowHeight:24,theme:'paper',defaultDataset:{kind:'samples'},
    filters:[{id:'filter-1',field:'label',op:'is',values:['Housing']}],
    parameters:[{name:'growth',type:'number',value:1.1,min:0,max:2}],
    tiles:[{id:'bar1',type:'bar',dataset:'categorical',binding:{mode:'explicit',ref:'categorical'},tileOptions:{topN:3,sort:'asc'},x:0,y:0,w:6,h:15}]};
  const candidate=validateLayout(input);
  const restored=validateLayout(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(restored.filters,input.filters);
  assert.deepEqual(restored.parameters,input.parameters);
  assert.equal(restored.tiles[0].tileOptions.topN,3);
  assert.deepEqual(validateLayout({...input,filters:undefined,parameters:undefined}).filters,[]);
  assert.throws(()=>validateLayout({...input,filters:[{id:'f',field:'label',op:'unknown',values:[]}]}),/filter/i);
});
