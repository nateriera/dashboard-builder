import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://localhost/'});
globalThis.document=dom.window.document;globalThis.window=dom.window;
for(const key of ['Node','Element','HTMLElement','SVGElement','NodeList','HTMLCollection','CustomEvent','getComputedStyle'])globalThis[key]=dom.window[key];
const { enumerateParameterOptions, validateParameters, substituteParameters } = await import('../src/data/parameters.js');
const { validateLayout } = await import('../src/data/layout.js');
const { decodeLayoutFile } = await import('../src/data/layoutImport.js');

const upload = { name:'Places', columns:['region'], fieldKeys:[], mapping:{}, rows:[{region:'West'},{region:'East'},{region:'West'}] };
const envelope = (parameters, extra={}) => ({ app:'dashboard-builder', version:5, rowHeight:24, tiles:[], parameters, ...extra });
const select = (type='single-select', value='West') => ({ name:'region', type, value, source:{dataset:'upload:places',column:'region'}, options:['West','East'] });

test('v5 parameter validation preserves bounded number, text, boolean, date, and range shapes', () => {
  const values = [
    {name:'count',type:'number',value:2,step:1,integer:true,min:0,max:5},
    {name:'note',type:'text',value:'ok'},
    {name:'enabled',type:'boolean',value:false},
    {name:'day',type:'date',value:'2024-02-29'},
    {name:'days',type:'date-range',value:{from:'2024-02-29',to:null}},
    {name:'amount',type:'number-range',value:{from:null,to:4}},
    select(), {...select('multi-select',['West','East']),name:'regions'}
  ];
  const result = validateParameters(values);
  assert.deepEqual(result.slice(0,6), values.slice(0,6));
  assert.equal(result[6].stale,false);
  assert.deepEqual(result[7].staleValues,[]);
  assert.deepEqual(validateParameters(JSON.parse(JSON.stringify(result))),result);
});

test('malformed v5 shapes, invalid calendar dates, duplicate selections, and number config fail closed', () => {
  for (const parameter of [
    {name:'d',type:'date',value:'2025-02-29'},
    {name:'d',type:'date',value:'2025-2-01'},
    {name:'r',type:'number-range',value:{from:null,to:null}},
    {name:'r',type:'number-range',value:{from:4,to:2}},
    {name:'r',type:'date-range',value:{from:'2025-01-01',to:'2025-02-30'}},
    {name:'m',type:'multi-select',value:['a','a'],source:{dataset:'categorical',column:'label'},options:['a']},
    {name:'n',type:'number',value:1,integer:true,step:0.5},
    {name:'b',type:'boolean',value:true,extra:1},
    {name:'x',type:'made-up',value:1}
  ]) assert.throws(() => validateParameters([parameter]), /parameter|select|range|step/i);
  assert.equal(validateParameters(Array.from({length:100},(_,index)=>({name:`p${index}`,type:'number',value:index}))).length,100);
  assert.throws(()=>validateParameters(Array.from({length:101},(_,index)=>({name:`p${index}`,type:'number',value:index}))),/parameters/i);
  assert.throws(()=>validateParameters([{name:'bad-name',type:'text',value:'x'}]),/parameter name/i);
});

test('select options enumerate first-seen values, cap at 200, and preserve stale values with flags', () => {
  const rows = Array.from({length:205},(_,index)=>({label:`v${index}`}));
  assert.deepEqual(enumerateParameterOptions(rows,'label'), {options:rows.slice(0,200).map(row=>row.label),overflow:{distinctCount:205}});
  const stale = validateParameters([{...select(),value:'Removed'}])[0];
  assert.equal(stale.value,'Removed');
  assert.equal(stale.stale,true);
  const many = validateParameters([{...select('multi-select',['Removed','West'])}])[0];
  assert.deepEqual(many.staleValues,['Removed']);
  assert.deepEqual(validateParameters([{...select('multi-select',[])}])[0].value,[]);
});

test('layout v5 pins select sources to sample/upload columns and rejects v5 shapes in legacy files by type', () => {
  const base = envelope([select()], {datasets:{places:upload}});
  assert.equal(validateLayout(base).version,5);
  assert.throws(()=>validateLayout(envelope([select()], {datasets:{places:upload},defaultDataset:{kind:'dataset',ref:'upload:places'}})),/dashboard default dataset/i);
  assert.throws(()=>validateLayout(envelope([{...select(),source:{dataset:'query:q',column:'region'}}])),/not a query/i);
  assert.throws(()=>validateLayout(envelope([{...select(),source:{dataset:'upload:places',column:'missing'}}],{datasets:{places:upload} })),/column missing/i);
  for (const parameter of [select(),{name:'flag',type:'boolean',value:true},{name:'stepper',type:'number',value:1,step:1}]) {
    const old={...base,version:4,parameters:[parameter]};
    assert.throws(()=>validateLayout(old),new RegExp(`v5-only parameter type ${parameter.type}`));
  }
  for (const version of [1,2,3,4]) {
    const old={app:'dashboard-builder',version,...(version>=3?{rowHeight:24}:{}),tiles:[],parameters:[{name:'n',type:'number',value:2},{name:'t',type:'text',value:'x'}]};
    assert.equal(validateLayout(old).version,5);
  }
});

test('typed SQL substitution quotes scalar selections, expands booleans and lists, and refuses bare ranges', () => {
  const parameters=[
    {name:'flag',type:'boolean',value:true},
    {name:'day',type:'date',value:'2025-01-02'},
    select('single-select',"O'Reilly"),
    {...select('multi-select',["O'Reilly",'East']),name:'many'},
    {...select('multi-select',[]),name:'empty'},
    {name:'span',type:'number-range',value:{from:1,to:2}}
  ];
  assert.equal(substituteParameters('SELECT {{flag}}, {{day}}, {{region}}, {{many}}, {{empty}}',parameters),"SELECT TRUE, '2025-01-02', 'O''Reilly', ('O''Reilly', 'East'), (NULL)");
  assert.throws(()=>substituteParameters('SELECT {{span}}',parameters),/span.*bindings, not SQL placeholders/i);
  for(const parameter of parameters.filter(item=>!['number','text'].includes(item.type))) {
    assert.throws(()=>substituteParameters(`SELECT '{{${parameter.name}}}'`,parameters),new RegExp(`${parameter.name}.*inside string`,'i'));
    assert.throws(()=>substituteParameters(`SELECT x{{${parameter.name}}}`,parameters),/adjacent/i);
  }
});

test('HTML editable backups decode to layout v5 and retain typed saved-view values', () => {
  const parameters=[{name:'period',type:'date-range',value:{from:'2025-01-01',to:'2025-01-31'}}];
  const layout=validateLayout(envelope(parameters,{savedViews:[{id:'view-1',name:'January',parameters,filters:[]}]}));
  const payload={app:'dashboard-builder',version:5,kind:'dashboard-export',layout};
  const decoded=decodeLayoutFile('dashboard.html',`<script id="dashboard-data" type="application/json">${JSON.stringify(payload)}</script>`);
  assert.equal(decoded.version,5);
  assert.deepEqual(decoded.parameters[0].value,parameters[0].value);
  assert.deepEqual(decoded.savedViews[0].parameters[0].value,parameters[0].value);
});
