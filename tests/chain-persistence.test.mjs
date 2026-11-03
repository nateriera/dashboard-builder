import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', {url:'https://localhost/'});
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
for (const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','CustomEvent','getComputedStyle']) globalThis[key] = dom.window[key];
const queries = await import('../src/data/queries.js');
const { validateLayout, assertNoCollisions } = await import('../src/data/layout.js');
const queryKey = 'dashbuilder.queries.v1';

function isolate(t) {
  const snapshot = queries.querySnapshot();
  const storage = ['dashbuilder.queries.v1','klaroDash.queries.v1'].map(key=>[key,localStorage.getItem(key)]);
  queries.rollbackQueries([]);
  for (const [key] of storage) localStorage.removeItem(key);
  t.after(()=>{
    queries.rollbackQueries(snapshot);
    for (const [key,value] of storage) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key,value);
    }
  });
}

function groupChain() {
  return {
    version:1,
    source:{table:'upload_source',dependencies:['upload:source'],schema:{columns:['region','value'],types:{region:'Utf8',value:'Float64'}},order:{kind:'sourceOrdinal'}},
    steps:[{id:'group',op:'groupBy',params:{groups:['region'],aggregations:[{column:'value',operation:'SUM',name:'total'}]}}],
    outputMapping:{label:'region',value:'total'}
  };
}

function parameterChain() {
  return {
    version:1,
    source:{sql:'SELECT region, value * {{factor}} AS value, date FROM upload_source',dependencies:['upload:source'],schema:{columns:['region','value','date'],types:{region:'Utf8',value:'Float64',date:'Utf8'}},order:null},
    steps:[
      {id:'dates',op:'bucket',params:{dateField:'date',grain:{param:'grain'},partitions:['region'],aggregations:[{column:'value',operation:'SUM',name:'total'}],periodName:'period'}},
      {id:'regions',op:'groupBy',params:{groups:['region'],aggregations:[{column:'total',operation:'SUM',name:'sum_total'}]}}
    ],
    outputMapping:{label:'region',value:'sum_total'}
  };
}

function save(chain = groupChain(), name = 'Editable chain') {
  const columns = chain.steps.length === 1 ? ['region','total'] : ['region','sum_total'];
  return queries.saveQuery({name,chain,columns,fieldKeys:['label','value'],mapping:chain.outputMapping,dependencies:['upload:source']});
}

function portable(id) { return queries.inlineQueries([`query:${id}`])[id]; }
function envelope(records, parameters = []) {
  return {app:'dashboard-builder',version:1,tiles:[],parameters,queries:records};
}

test('a chain save derives canonical raw SQL and persists its editable form through reload', async t => {
  isolate(t);
  const chain = groupChain(), before = structuredClone(chain);
  const saved = save(chain);
  const record = queries.getQuery(saved.id);
  assert.deepEqual(record.chain,before);
  const {compileTransformChain} = await import('../src/data/wranglingTransforms.js');
  assert.equal(record.sql,compileTransformChain(record.chain).sql);
  assert.equal(saved.persisted,true);
  assert.deepEqual(JSON.parse(localStorage.getItem(queryKey)).items[saved.id].chain,before);
  chain.steps[0].params.aggregations[0].name = 'Caller mutation';
  chain.outputMapping.value = 'Caller mutation';
  assert.deepEqual(record.chain,before);
  queries.rollbackQueries([]);
  assert.equal(queries.loadPersistedQueries(),1);
  assert.deepEqual(queries.getQuery(saved.id).chain,before);
  assert.equal(queries.getQuery(saved.id).sql,compileTransformChain(before).sql);
  assert.equal(queries.getQuery(saved.id).trusted,true);
});

test('raw parameter placeholders and named step references survive all query carriers with separate dependencies', t => {
  isolate(t);
  const chain = parameterChain();
  const saved = save(chain), record = queries.getQuery(saved.id);
  assert.deepEqual(record.chain,chain);
  assert.deepEqual(record.dependencies,['upload:source']);
  assert.deepEqual([...record.parameterDependencies].sort(),['factor','grain']);
  assert.match(record.sql,/\{\{factor\}\}/);
  assert.match(record.sql,/\{\{grain\}\}/);
  const serialized = JSON.parse(queries.serializeQueries()).items[saved.id];
  assert.deepEqual(serialized.chain,chain);
  assert.deepEqual([...serialized.parameterDependencies].sort(),['factor','grain']);
  const exported = portable(saved.id);
  assert.deepEqual(exported.chain,chain);
  assert.deepEqual([...exported.parameterDependencies].sort(),['factor','grain']);
  queries.rollbackQueries([]);
  const input = {[saved.id]:JSON.parse(JSON.stringify(exported))};
  assert.equal(queries.restoreQueries(input),1);
  input[saved.id].chain.steps.reverse();
  assert.deepEqual(queries.getQuery(saved.id).chain,chain);
  assert.equal(queries.getQuery(saved.id).trusted,false);
  assert.deepEqual([...queries.getQuery(saved.id).parameterDependencies].sort(),['factor','grain']);
});

test('inline exports and snapshots isolate nested chain edits from the live query', t => {
  isolate(t);
  const original = groupChain(), saved = save(original);
  const exported = portable(saved.id);
  assert.deepEqual(exported.chain,original);
  exported.chain.steps[0].params.groups[0] = 'mutated';
  assert.deepEqual(queries.getQuery(saved.id).chain,original);
  const snapshot = queries.querySnapshot();
  assert.deepEqual(snapshot[0][1].chain,original);
  snapshot[0][1].chain.steps.splice(0,1);
  assert.deepEqual(queries.getQuery(saved.id).chain,original);
});

test('snapshots, import serialization and pruning preserve retained chains and discard only unreferenced records', t => {
  isolate(t);
  const first = save(groupChain(),'First'), second = save(groupChain(),'Second');
  const snapshot = queries.querySnapshot();
  queries.rollbackQueries([]);
  queries.rollbackQueries(snapshot);
  assert.deepEqual(queries.getQuery(first.id).chain,groupChain());
  assert.equal(queries.pruneQueries([`query:${first.id}`]),1);
  assert.equal(queries.getQuery(second.id),null);
  assert.deepEqual(JSON.parse(localStorage.getItem(queryKey)).items[first.id].chain,groupChain());
  const serialized = queries.serializeQueries();
  queries.rollbackQueries([]);localStorage.setItem(queryKey,serialized);queries.loadPersistedQueries();
  assert.deepEqual(queries.getQuery(first.id).chain,groupChain());
});

test('SQL-only queries keep their prior shape through save, reload, inline, layout and import', t => {
  isolate(t);
  const input = {name:'Hand written',sql:'SELECT label, value FROM categorical',columns:['label','value'],fieldKeys:['label','value'],mapping:{label:'label',value:'value'},dependencies:['categorical']};
  const saved = queries.saveQuery(input);
  const exported = portable(saved.id);
  assert.equal(queries.getQuery(saved.id).sql,input.sql);
  assert.equal(Object.hasOwn(queries.getQuery(saved.id),'chain'),false);
  assert.equal(Object.hasOwn(queries.getQuery(saved.id),'parameterDependencies'),false);
  assert.equal(Object.hasOwn(exported,'chain'),false);
  const candidate = validateLayout(envelope({legacy:exported}));
  assert.equal(candidate.queries.legacy.sql,input.sql);
  assert.equal(Object.hasOwn(candidate.queries.legacy,'chain'),false);
  queries.rollbackQueries([]);
  queries.restoreQueries(candidate.queries);
  assert.equal(queries.getQuery('legacy').trusted,false);
  assert.equal(Object.hasOwn(queries.getQuery('legacy'),'chain'),false);
  localStorage.setItem(queryKey,queries.serializeQueries());
  queries.rollbackQueries([]);queries.loadPersistedQueries();
  assert.equal(queries.getQuery('legacy').sql,input.sql);
  assert.equal(Object.hasOwn(queries.getQuery('legacy'),'chain'),false);
});

test('layout export/import retains chain fields and parameter references without a version bump', t => {
  isolate(t);
  const saved = save(parameterChain());
  const record = portable(saved.id);
  assert.deepEqual(record.chain,parameterChain());
  const input = envelope({[saved.id]:record},[{name:'factor',type:'number',value:2},{name:'grain',type:'text',value:'month'}]);
  const candidate = validateLayout(input);
  assert.equal(candidate.version,4);
  assert.deepEqual(candidate.queries[saved.id].chain,parameterChain());
  assert.deepEqual([...candidate.queries[saved.id].parameterDependencies].sort(),['factor','grain']);
  const roundTrip = validateLayout(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(roundTrip.queries[saved.id].chain,parameterChain());
  assert.deepEqual(input.queries[saved.id].chain,parameterChain());
});

test('invalid chains and SQL/chain disagreement reject import without falling back to bare SQL', t => {
  isolate(t);
  const saved = save(groupChain()), valid = portable(saved.id);
  assert.deepEqual(valid.chain,groupChain());
  const before = queries.querySnapshot(), storage = localStorage.getItem(queryKey);
  const invalid = [
    {...valid,chain:{...valid.chain,version:999}},
    {...valid,chain:{...valid.chain,steps:[{id:'foreign',op:'cumulative',params:{field:'value'}}]}},
    {...valid,sql:'SELECT 999 AS total'},
    {...valid,chain:{...valid.chain,outputMapping:{value:'missing'}}}
  ];
  for (const record of invalid) {
    assert.throws(()=>validateLayout(envelope({bad:record})));
    assert.deepEqual(queries.querySnapshot(),before);
    assert.equal(localStorage.getItem(queryKey),storage);
  }
});

test('restoring a batch validates every chain before introducing any new query', t => {
  isolate(t);
  const saved = save(groupChain()), valid = portable(saved.id);
  assert.deepEqual(valid.chain,groupChain());
  const before = queries.querySnapshot(), storage = localStorage.getItem(queryKey);
  const input = {good:structuredClone(valid),bad:{...structuredClone(valid),chain:{...structuredClone(valid.chain),version:999}}};
  const raw = structuredClone(input);
  assert.throws(()=>queries.restoreQueries(input));
  assert.deepEqual(queries.querySnapshot(),before);
  assert.equal(queries.getQuery('good'),null);
  assert.equal(queries.getQuery('bad'),null);
  assert.equal(localStorage.getItem(queryKey),storage);
  assert.deepEqual(input,raw);
});

test('explicit stale SQL on save and chain changes under an existing query ID are rejected', t => {
  isolate(t);
  const saved = save(groupChain()), valid = portable(saved.id);
  assert.deepEqual(valid.chain,groupChain());
  const before = queries.querySnapshot(), storage = localStorage.getItem(queryKey);
  assert.throws(()=>queries.saveQuery({...valid,sql:'SELECT 999 AS total',name:'Stale compilation'}));
  assert.deepEqual(queries.querySnapshot(),before);
  assert.equal(localStorage.getItem(queryKey),storage);
  const changed = structuredClone(valid); changed.chain.steps[0].params.aggregations[0].operation='AVG';
  assert.throws(()=>assertNoCollisions({datasets:{},queries:{[saved.id]:changed}},()=>null,queries.getQuery),/Conflicting/);
  assert.deepEqual(queries.getQuery(saved.id).chain,groupChain());
});
