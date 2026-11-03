import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parameterConsumers, validateDetachedParameterConsumers } from '../src/data/parameterConsumers.js';

const chain = {
  source: { sql: "SELECT {{sourceValue}} AS value", },
  steps: [{ params: { n: { param: 'stepCount' } } }]
};

test('parameter consumers reuse the SQL lexer, typed chain dependency enumerator, and saved-view values', () => {
  const queries = [
    { id: 'q1', name: 'Forecast SQL', sql: "SELECT {{growth}} AS value, '{{ignored}}' AS label -- {{commented}}" },
    { id: 'q2', name: 'Forecast chain', sql: 'SELECT 1', chain }
  ];
  const views = [{ id: 'v1', name: 'Prior scenario', parameters: [{ name: 'growth', value: 1 }] }];

  assert.deepEqual(parameterConsumers('growth', queries, views), [
    { kind: 'querySql', id: 'q1', label: 'Query “Forecast SQL”' },
    { kind: 'savedView', id: 'v1', label: 'Saved view “Prior scenario”' }
  ]);
  assert.deepEqual(parameterConsumers('sourceValue', queries, views), [
    { kind: 'chain', id: 'q2', label: 'Transform chain “Forecast chain”' }
  ]);
  assert.deepEqual(parameterConsumers('stepCount', queries, views).map(item => item.kind), ['chain']);
});

test('detached binding state is validated and removed from the active consumer registry', () => {
  const query = { id: 'q1', name: 'Growth query', sql: 'SELECT {{growth}}', detachedParameterConsumers: [{ kind: 'querySql', name: 'growth' }] };
  assert.deepEqual(validateDetachedParameterConsumers(query.detachedParameterConsumers), [{ kind: 'querySql', name: 'growth' }]);
  assert.deepEqual(parameterConsumers('growth', [query], []), []);
  assert.throws(() => validateDetachedParameterConsumers([{ kind: 'savedView', name: 'growth' }]), /Invalid detached parameter binding/);
});

test('range parameters used by both Between bounds are registered as chain consumers', () => {
  const query={id:'q-range',name:'Range query',sql:'SELECT 1',chain:{source:{sql:'SELECT value FROM fixture'},steps:[{id:'between',op:'between',params:{field:'value',mode:'numeric',lower:{param:'amountRange'},upper:{param:'amountRange'}}}]}};
  assert.deepEqual(parameterConsumers('amountRange',[query],[]),[{kind:'chain',id:'q-range',label:'Transform chain “Range query”'}]);
});
