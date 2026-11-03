import { compileTransformChain } from './wranglingTransforms.js';

const sameMapping=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
/** Optional chain fields use one boundary across save, restore and layouts.
 * SQL-only records deliberately acquire no transform metadata. */
export function checkedChainFields(record, options = {}) {
  if(record.chain===undefined) return {};
  const plan=compileTransformChain(record.chain,options);
  if(!plan.sql) throw new Error('Invalid transform chain: '+plan.errors.join(' '));
  if(record.sql!==undefined&&record.sql!==plan.sql) throw new Error('Saved SQL does not match its transform chain.');
  if(record.mapping!==undefined&&!sameMapping(record.mapping,plan.chain.outputMapping)) throw new Error('Query mapping does not match its transform chain.');
  if(record.columns?.length&&JSON.stringify(record.columns)!==JSON.stringify(plan.columns)) throw new Error('Query columns do not match its transform chain.');
  if(record.dependencies!=null&&JSON.stringify(record.dependencies)!==JSON.stringify(plan.chain.source.dependencies)) throw new Error('Query dependencies do not match its transform source.');
  if(record.parameterDependencies!==undefined&&(!Array.isArray(record.parameterDependencies)||JSON.stringify([...record.parameterDependencies].sort())!==JSON.stringify([...plan.parameterDependencies].sort()))) throw new Error('Invalid transform parameter dependencies.');
  return {chain:plan.chain,sql:plan.sql,columns:[...plan.columns],mapping:{...plan.chain.outputMapping},dependencies:plan.chain.source.dependencies,parameterDependencies:plan.parameterDependencies};
}
