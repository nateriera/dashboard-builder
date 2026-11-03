import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionExportViews } from '../src/export/savedViews.js';

const growth=value=>({name:'growth',type:'number',value,min:0,max:10});
const region={name:'region',type:'text',value:'North'};
test('HTML saved views compare parameter values by name, independent of order and numeric bounds', () => {
  const view={id:'same',name:'Matching',parameters:[region,{...growth(2),max:5}],theme:'ink',filters:[]};
  const result=partitionExportViews([view],[growth(2),region]);
  assert.deepEqual(result,{included:[view],excluded:[],viewerViews:[{...view,disabled:false,disabledReason:null}]});
  assert.equal(result.included[0],view);
});
test('HTML export names differing saved views and explains the parameter difference without changing them', () => {
  const views=[{id:'old',name:'Old forecast',parameters:[growth(1),region]},{id:'same',name:'Current',parameters:[growth(2),region]}];
  const before=structuredClone(views);
  const result=partitionExportViews(views,[growth(2),region]);
  assert.deepEqual(result.included,[views[1]]);
  assert.equal(result.excluded[0].name,'Old forecast');
  assert.match(result.excluded[0].reason,/growth.*1.*2/);
  assert.deepEqual(result.viewerViews.map(item=>item.disabled),[true,false]);
  assert.match(result.viewerViews[0].disabledReason,/growth.*1.*2/);
  assert.deepEqual(views,before);
});
test('missing or extra saved parameter values are excluded, while matching empty sets remain exportable', () => {
  const empty={id:'empty',name:'No parameters',parameters:[]},one={id:'one',name:'Growth only',parameters:[growth(1)]};
  assert.deepEqual(partitionExportViews([empty],[]).included,[empty]);
  assert.equal(partitionExportViews([empty],[growth(1)]).excluded[0].name,'No parameters');
  assert.equal(partitionExportViews([one],[]).excluded[0].name,'Growth only');
});

test('HTML view partitioning compares typed range objects and select lists by value', () => {
  const parameters=[{name:'window',value:{from:'2025-01-01',to:null}},{name:'regions',value:['West','East']}];
  const views=[
    {id:'same',name:'Same',parameters:structuredClone(parameters)},
    {id:'different',name:'Different',parameters:[{name:'window',value:{from:'2025-01-02',to:null}},{name:'regions',value:['West','East']}]}
  ];
  const result=partitionExportViews(views,parameters);
  assert.deepEqual(result.included.map(view=>view.id),['same']);
  assert.deepEqual(result.excluded.map(view=>view.name),['Different']);
});
