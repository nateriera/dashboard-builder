import { referencedParameterNames } from './parameterSql.js';
import { transformParameterDependencies } from './wranglingTransforms.js';

const detached = (query, kind, name) => (query.detachedParameterConsumers || [])
  .some(item => item.kind === kind && item.name === name);

export function validateDetachedParameterConsumers(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid detached parameter bindings.');
  const seen = new Set();
  return input.map(item => {
    if (!item || !['querySql', 'chain'].includes(item.kind) || typeof item.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)) throw new Error('Invalid detached parameter binding.');
    const key = `${item.kind}:${item.name}`;
    if (seen.has(key)) throw new Error('Duplicate detached parameter binding.');
    seen.add(key);
    return { kind: item.kind, name: item.name };
  });
}

/** Enumerate parameter consumers using the same parsers used at execution. */
export function parameterConsumers(name, queries = [], savedViews = []) {
  const consumers = [];
  for (const query of queries) {
    if (!query || typeof query.sql !== 'string') continue;
    if (query.chain) {
      if (!detached(query, 'chain', name) && transformParameterDependencies(query.chain).includes(name)) {
        consumers.push({ kind: 'chain', id: query.id, label: `Transform chain “${query.name || query.id}”` });
      }
    } else if (!detached(query, 'querySql', name) && referencedParameterNames(query.sql).includes(name)) {
      consumers.push({ kind: 'querySql', id: query.id, label: `Query “${query.name || query.id}”` });
    }
  }
  for (const view of savedViews) {
    if ((view.parameters || []).some(parameter => parameter.name === name) && !(view.brokenParameters || []).includes(name)) {
      consumers.push({ kind: 'savedView', id: view.id, label: `Saved view “${view.name}”` });
    }
  }
  return consumers;
}

export function parameterConsumerKindLabel(kind) {
  return ({ querySql: 'query SQL', chain: 'transform chain', savedView: 'saved view' })[kind] || kind;
}
