import { quoteIdentifier, aggregationOptions } from './wrangling.js';
import { prepareStatement } from './sqlStatement.js';
import { substituteParameters, validateParameters } from './parameters.js';
import { LIMITS } from './limits.js';

/** Chain v1 is the editable source; SQL returned by compileTransformChain is
 * an unresolved execution artifact. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const own = (value,key) => Object.hasOwn(value,key);
const reserved = new Set(['__proto__','prototype','constructor']);
const name = (value,label='column') => typeof value === 'string' && value.length > 0 && value.length <= 200 && !reserved.has(value) ? value : fail(`Invalid transform ${label}.`);
function fields(value,label,max=20) {
  if (!Array.isArray(value) || value.length > max) fail(`Invalid transform ${label}.`);
  const result=value.map(item=>name(item,label));
  if(new Set(result.map(item=>item.toLowerCase())).size!==result.length) fail(`Duplicate transform ${label}.`);
  return result;
}
function shape(value,allowed,label) {
  if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))) fail(`Invalid transform ${label}.`);
}
function aggregates(input) {
  if(!Array.isArray(input)||!input.length||input.length>20) fail('Add between 1 and 20 transform aggregations.');
  return input.map(item=>{
    shape(item,['column','operation','name'],'aggregation');
    const column=item.column == null || item.column === '' ? null : name(item.column);
    const operation=item.operation || (column ? 'SUM' : 'COUNT');
    if(!['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'].includes(operation)) fail('Invalid transform aggregation operation.');
    if(operation!=='COUNT'&&!column) fail(`${operation} needs a value column.`);
    return {column,operation,name:name(item.name,'output name')};
  });
}
function parameterReference(input,label) {
  if(!object(input)) return null;
  shape(input,['param'],`${label} reference`);
  if(typeof input.param!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.param)) fail(`Invalid ${label} parameter reference.`);
  return {param:input.param};
}
function bound(input,mode,label) {
  const reference=parameterReference(input,label);
  if(reference)return reference;
  if(mode==='numeric'&&typeof input==='number'&&Number.isFinite(input))return input;
  if(mode==='date'&&typeof input==='string'&&input.length<=1000)return input;
  fail(`Invalid ${mode} ${label} bound.`);
}
function rawParameterNames(sql) {
  const names=[...new Set([...sql.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map(match=>match[1]))];
  // Reuse the execution boundary's context/adjacency checks; discard its
  // expanded copy, keeping only the original source and reference names.
  substituteParameters(sql,names.map(name=>({name,type:'text',value:'validation'})));
  return names;
}
export function transformParameterDependencies(chain) {
  const operationRefs=chain.steps.flatMap(step=>{
    const params=step.params||{};
    return [params.grain,params.lower,params.upper,params.n,params.window].filter(object).map(reference=>reference.param);
  });
  return [...new Set([...rawParameterNames(chain.source.sql || ''),...operationRefs])];
}

export function validateTransformChain(input,{parameters}={}) {
  shape(input,['version','source','steps','outputMapping'],'chain');
  if(input.version!==1) fail('Unsupported transform chain version.');
  shape(input.source,['table','sql','dependencies','schema','order'],'source');
  const source=input.source;
  if(!!source.table===!!source.sql) fail('Choose exactly one transform table or SQL source.');
  if(source.sql && (typeof source.sql!=='string'||source.sql.length>100000)) fail('Invalid transform source SQL.');
  if(source.sql) {prepareStatement(source.sql);rawParameterNames(source.sql);}
  const dependencies=source.dependencies ?? null;
  if(dependencies!==null&&(!Array.isArray(dependencies)||dependencies.length>100||dependencies.some(ref=>typeof ref!=='string'||!/^(?:upload:)?[a-zA-Z0-9_-]{1,100}$/.test(ref)))) fail('Invalid transform source dependencies.');
  shape(source.schema,['columns','types'],'source schema');
  const columns=fields(source.schema.columns,'source columns',LIMITS.columns);
  if(!object(source.schema.types)||Object.entries(source.schema.types).some(([key,type])=>!columns.includes(key)||typeof type!=='string'||type.length>100)) fail('Invalid transform source types.');
  const types=Object.fromEntries(columns.map(column=>[column,source.schema.types[column]||'Unknown']));
  let order=null;
  if(source.order!=null) {
    shape(source.order,['kind','fields'],'source order');
    if(source.order.kind==='sourceOrdinal'&&source.table&&!source.order.fields) order={kind:'sourceOrdinal'};
    else if(source.order.kind==='columns') {
      const chosen=fields(source.order.fields,'order fields');
      if(!chosen.length||chosen.some(field=>!columns.includes(field))) fail('Choose existing source order fields.');
      order={kind:'columns',fields:chosen};
    } else fail('Invalid deterministic source order.');
  }
  if(!Array.isArray(input.steps)||input.steps.length>30) fail('A transform chain supports at most 30 steps.');
  const ids=new Set();
  const steps=input.steps.map(step=>{
    shape(step,['id','op','params'],'step');
    if(typeof step.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(step.id)||ids.has(step.id)) fail('Invalid or duplicate transform step id.');
    ids.add(step.id);
    if(step.op==='groupBy') {
      shape(step.params,['groups','aggregations'],'GroupBy parameters');
      return {id:step.id,op:step.op,params:{groups:fields(step.params.groups||[],'grouping fields'),aggregations:aggregates(step.params.aggregations)}};
    }
    if(step.op==='bucket') {
      shape(step.params,['dateField','grain','partitions','aggregations','periodName'],'Bucket parameters');
      let grain=step.params.grain || 'day';
      if(object(grain)) {
        grain=parameterReference(grain,'bucket grain');
      } else if(!['day','week','month'].includes(grain)) fail('Bucket grain must be day, week, or month.');
      return {id:step.id,op:step.op,params:{dateField:name(step.params.dateField),grain,partitions:fields(step.params.partitions||[],'partition fields'),aggregations:aggregates(step.params.aggregations),periodName:name(step.params.periodName||'period','period name')}};
    }
    if(step.op==='between') {
      shape(step.params,['field','mode','lower','upper'],'Between parameters');
      const mode=step.params.mode||'numeric';
      if(!['numeric','date'].includes(mode))fail('Between mode must be numeric or date.');
      return {id:step.id,op:step.op,params:{field:name(step.params.field),mode,lower:bound(step.params.lower,mode,'lower'),upper:bound(step.params.upper,mode,'upper')}};
    }
    if(step.op==='top') {
      shape(step.params,['field','n','direction'],'Top parameters');
      const n=parameterReference(step.params.n,'Top N')||step.params.n;
      if(typeof n==='number'&&!Number.isFinite(n))fail('Invalid Top N.');
      if(typeof n!=='number'&&!object(n))fail('Top N must be a number or parameter reference.');
      const direction=step.params.direction||'desc';
      if(!['desc','asc'].includes(direction))fail('Top direction must be desc or asc.');
      return {id:step.id,op:step.op,params:{field:name(step.params.field),n,direction}};
    }
    if(step.op==='movingAvg') {
      shape(step.params,['field','window','partitions'],'MovingAvg parameters');
      const window=parameterReference(step.params.window,'MovingAvg window')||step.params.window;
      if(typeof window!=='number'||!Number.isFinite(window))if(!object(window))fail('MovingAvg window must be a number or parameter reference.');
      if(typeof window==='number'&&(!Number.isInteger(window)||window<1))fail('MovingAvg window must be an integer of at least 1.');
      return {id:step.id,op:step.op,params:{field:name(step.params.field),window,partitions:fields(step.params.partitions||[],'partition fields')}};
    }
    if(step.op==='stats') {
      shape(step.params,['field'],'Stats parameters');
      return {id:step.id,op:step.op,params:{field:name(step.params.field)}};
    }
    fail(`Unsupported transform operation: ${step.op}.`);
  });
  if(!object(input.outputMapping)||Object.keys(input.outputMapping).length>LIMITS.columns) fail('Invalid transform output mapping.');
  const outputMapping=Object.fromEntries(Object.entries(input.outputMapping).map(([key,column])=>[name(key,'mapping field'),name(column,'mapping column')]));
  const chain={version:1,source:{...(source.table?{table:name(source.table,'table')}:{sql:source.sql}),dependencies:dependencies&&[...dependencies],schema:{columns,types},order},steps,outputMapping};
  if(parameters!==undefined) {
    const existing=new Map(validateParameters(parameters).map(parameter=>[parameter.name,parameter]));
    for(const dependency of transformParameterDependencies(chain)) if(!existing.has(dependency)) fail(`Unknown transform parameter: ${dependency}.`);
    for(const step of steps) if(object(step.params.grain)&&existing.get(step.params.grain.param)?.type!=='text') fail(`Bucket parameter ${step.params.grain.param} must be text.`);
  }
  return chain;
}

const q=quoteIdentifier;
const literal=value=>`'${value.replaceAll("'","''")}'`;
const numeric=type=>aggregationOptions(type).includes('SUM');
const blank=field=>`CASE WHEN ${q(field)} IS NULL THEN '(blank)' ELSE CAST(${q(field)} AS VARCHAR) END`;
function aggregateSql(aggregate,types) {
  const field=aggregate.column&&q(aggregate.column);
  if(aggregate.operation==='COUNT') return {expression:'COUNT(*)',exclusion:null,type:'Int64'};
  if(aggregate.operation==='COUNT DISTINCT') return {expression:`COUNT(DISTINCT ${field})`,exclusion:`${field} IS NULL`,type:'Int64'};
  const valid=numeric(types[aggregate.column])?`(${field} IS NOT NULL AND isfinite(${field}))`:'FALSE';
  const value=numeric(types[aggregate.column])?`CASE WHEN ${valid} THEN ${field} END`:'NULL::DOUBLE';
  let expression=`${aggregate.operation}(${value})`,type='Float64';
  if(['MIN','MAX'].includes(aggregate.operation)&&numeric(types[aggregate.column])) type=types[aggregate.column];
  // DuckDB widens integer SUM to HUGEINT (Arrow Decimal). Keep integer
  // results exact and materializable; an out-of-range sum fails visibly.
  if(aggregate.operation==='SUM'&&/^(?:U?Int|U?TinyInt|U?SmallInt|U?BigInt|Integer)/i.test(types[aggregate.column]||'')) {
    type=/^U/i.test(types[aggregate.column])?'Uint64':'Int64';
    expression=`CAST(${expression} AS ${type==='Uint64'?'UBIGINT':'BIGINT'})`;
  }
  return {expression:aggregate.operation==='SUM'?`COALESCE(${expression}, 0)`:expression,exclusion:`NOT (${valid})`,type};
}
const withSql=(ctes,select)=>`WITH ${ctes.join(',\n')}\n${select}`;

export function compileTransformChain(input,options={}) {
  const chain=validateTransformChain(input,options);
  const parameterDependencies=transformParameterDependencies(chain);
  const parameters=options.parameters===undefined?null:validateParameters(options.parameters);
  const parameterByName=new Map((parameters||[]).map(parameter=>[parameter.name,parameter]));
  let columns=[...chain.source.schema.columns],types={...chain.source.schema.types};
  const statColumns=['count','min','max','mean','median','stddev'];
  const allNames=[...columns,...chain.steps.flatMap(step=>[...(step.params.aggregations||[]).map(agg=>agg.name),step.params.periodName,...(step.op==='stats'?statColumns:[])].filter(Boolean))].map(name=>name.toLowerCase());
  let ordinal='__transform_ordinal';while(allNames.includes(ordinal.toLowerCase()))ordinal+='_';
  let prefix='__transform';while(chain.source.table?.toLowerCase().startsWith(prefix))prefix+='_';
  let ordered=!!chain.source.order,orderNeedsCheck=chain.source.order?.kind==='columns';
  const sourceName=`${prefix}_0`;
  const from=chain.source.sql?`(${prepareStatement(chain.source.sql)}) AS source_rows`:q(chain.source.table);
  const order=chain.source.order;
  const orderSql=order?.kind==='sourceOrdinal'?'rowid':order?.kind==='columns'?order.fields.map(field=>`${q(field)} NULLS FIRST`).join(', '):null;
  if(order?.kind==='sourceOrdinal'&&columns.some(column=>column.toLowerCase()==='rowid')) ordered=false;
  const ctes=[`${q(sourceName)} AS (SELECT ${columns.map(q).join(', ')}${columns.length?', ':''}${ordered?`ROW_NUMBER() OVER (ORDER BY ${orderSql})`:'NULL::BIGINT'} AS ${q(ordinal)} FROM ${from})`];
  let previous=sourceName,blocked=false;
  const steps=[],guards=[];
  const output=(name,cols=columns)=>`SELECT ${cols.map(q).join(', ')} FROM ${q(name)} ORDER BY ${q(ordinal)}`;
  const numericValid=field=>`(${q(field)} IS NOT NULL AND isfinite(${q(field)}))`;
  const dateValid=field=>`TRY_CAST(${q(field)} AS TIMESTAMP) IS NOT NULL`;
  const isDate=type=>/DATE|TIMESTAMP|CHAR|STRING|UTF8|UNKNOWN|NULL/i.test(type||'');
  const boundValue=input=>object(input)?parameterByName.get(input.param)?.value:input;
  const boundSql=(input,mode)=>{
    const raw=object(input)?`{{${input.param}}}`:mode==='date'?literal(input):String(input);
    return mode==='date'?`TRY_CAST(${raw} AS TIMESTAMP)`:raw;
  };
  const integerValue=input=>object(input)?parameterByName.get(input.param)?.value:input;
  for(const [index,step] of chain.steps.entries()) {
    const p=step.params,params=p.aggregations||[];
    const inputs=step.op==='groupBy'?[...p.groups,...params.map(agg=>agg.column).filter(Boolean)]:step.op==='bucket'?[p.dateField,...p.partitions,...params.map(agg=>agg.column).filter(Boolean)]:step.op==='stats'?[p.field]:step.op==='movingAvg'?[p.field,...p.partitions]:[p.field];
    const missing=inputs.find(field=>!columns.includes(field));
    const names=step.op==='groupBy'?[...p.groups,...params.map(agg=>agg.name)]:step.op==='bucket'?[...p.partitions,p.periodName,...params.map(agg=>agg.name)]:step.op==='stats'?statColumns:[...columns];
    let reason=blocked?'A preceding step is disabled.':missing?`Input column ${missing} is unavailable after the preceding step.`:'';
    let warning=null;
    if(!reason&&new Set(names.map(name=>name.toLowerCase())).size!==names.length) reason='Transform output column names must be unique.';
    const orderSensitive=step.op==='top'||step.op==='movingAvg'||step.op==='groupBy'&&p.groups.length>0;
    if(!reason&&orderSensitive&&!ordered) reason=`${step.op==='groupBy'?'GroupBy':step.op==='movingAvg'?'MovingAvg':'Top'} needs a deterministic incoming order. Choose source order fields.`;
    if(!reason&&step.op==='bucket'&&!isDate(types[p.dateField])) reason='Bucket requires a date, timestamp, or date-string column.';
    if(!reason&&step.op==='bucket'&&object(p.grain)&&options.parameters!==undefined) {
      const parameter=parameterByName.get(p.grain.param);
      if(parameter?.type!=='text'||!['day','week','month'].includes(parameter.value)) reason=`Bucket parameter ${p.grain.param} must be text with value day, week, or month.`;
    }
    if(!reason&&step.op==='between'&&(p.mode==='numeric'?!numeric(types[p.field]):!isDate(types[p.field]))) reason=`Between ${p.mode} mode is incompatible with ${types[p.field]||'unknown'} column ${p.field}.`;
    if(!reason&&(step.op==='top'||step.op==='movingAvg'||step.op==='stats')&&!numeric(types[p.field])) reason=`${step.op==='top'?'Top':step.op==='movingAvg'?'MovingAvg':'Stats'} requires a numeric column.`;
    if(!reason&&step.op==='movingAvg'&&object(p.window)) {
      const parameter=parameterByName.get(p.window.param);
      if(options.parameters!==undefined&&(parameter?.type!=='number'||!Number.isInteger(parameter.value)||parameter.value<1)) reason=`MovingAvg window ${p.window.param} must be a numeric integer of at least 1.`;
    }
    const inputSql=withSql(ctes,output(previous));
    if(reason) {steps.push({...step,disabled:true,reason,inputSql,sql:null,diagnosticsSql:null,inputColumns:[...columns],columns:[...columns]});blocked=true;continue;}
    const stage=`${prefix}_${index+1}`,inputColumns=[...columns];
    const measures=params.map(agg=>({...agg,...aggregateSql(agg,types)}));
    if(step.op==='groupBy') {
      if(orderSensitive&&orderNeedsCheck) {
        guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      }
      const selections=[...p.groups.map(field=>`${blank(field)} AS ${q(field)}`),...measures.map(agg=>`${agg.expression} AS ${q(agg.name)}`),`COALESCE(MIN(${q(ordinal)}), 0) AS ${q(ordinal)}`];
      ctes.push(`${q(stage)} AS (SELECT ${selections.join(', ')} FROM ${q(previous)}${p.groups.length?' GROUP BY '+p.groups.map(q).join(', '):''})`);
    } else if(step.op==='bucket') {
      const grain=object(p.grain)?`{{${p.grain.param}}}`:literal(p.grain);
      const valid=`${stage}_valid`,actual=`${stage}_actual`,bounds=`${stage}_bounds`,grid=`${stage}_grid`;
      let period='__transform_period';while(allNames.includes(period.toLowerCase())||period===ordinal)period+='_';
      const date=`TRY_CAST(${q(p.dateField)} AS TIMESTAMP)`;
      ctes.push(`${q(valid)} AS (SELECT *, date_trunc(${grain}, ${date}) AS ${q(period)} FROM ${q(previous)} WHERE ${date} IS NOT NULL)`);
      const keys=[...p.partitions.map(q),q(period)];
      ctes.push(`${q(actual)} AS (SELECT ${keys.join(', ')}, ${measures.map(agg=>`${agg.expression} AS ${q(agg.name)}`).join(', ')} FROM ${q(valid)} GROUP BY ${keys.join(', ')})`);
      const fill=measures.some(agg=>['SUM','COUNT'].includes(agg.operation));
      let result=actual,selectPrefix='';
      if(fill) {
        let lo='__transform_lo',hi='__transform_hi';while(allNames.includes(lo.toLowerCase()))lo+='_';while(allNames.includes(hi.toLowerCase()))hi+='_';
        ctes.push(`${q(bounds)} AS (SELECT ${p.partitions.length?p.partitions.map(q).join(', ')+', ':''}MIN(${q(period)}) AS ${q(lo)}, MAX(${q(period)}) AS ${q(hi)} FROM ${q(valid)}${p.partitions.length?' GROUP BY '+p.partitions.map(q).join(', '):' HAVING COUNT(*) > 0'})`);
        const interval=`CASE ${grain} WHEN 'day' THEN INTERVAL 1 DAY WHEN 'week' THEN INTERVAL 1 WEEK ELSE INTERVAL 1 MONTH END`;
        guards.push({stepId:step.id,sql:withSql(ctes,`SELECT CAST(COALESCE(SUM(date_diff(${grain}, ${q(lo)}, ${q(hi)}) + 1), 0) AS BIGINT) AS periods FROM ${q(bounds)}`),max:LIMITS.queryRows,reason:`Bucket output exceeds the ${LIMITS.queryRows.toLocaleString()} row query budget.`});
        ctes.push(`${q(grid)} AS (SELECT ${p.partitions.map(field=>`b.${q(field)}, `).join('')}s.period AS ${q(period)} FROM ${q(bounds)} b, LATERAL generate_series(b.${q(lo)}, b.${q(hi)}, ${interval}) s(period))`);
        const joins=[...p.partitions.map(field=>`a.${q(field)} IS NOT DISTINCT FROM g.${q(field)}`),`a.${q(period)} = g.${q(period)}`];
        result=`${q(grid)} g LEFT JOIN ${q(actual)} a ON ${joins.join(' AND ')}`;
        selectPrefix='g.';
      } else result=q(result);
      const periodValue=`${selectPrefix}${q(period)}`;
      const periodText=`CASE WHEN ${grain} = 'month' THEN strftime(${periodValue}, '%Y-%m') ELSE strftime(${periodValue}, '%Y-%m-%d') END`;
      const partitions=p.partitions.map(field=>`${fill?`CASE WHEN g.${q(field)} IS NULL THEN '(blank)' ELSE CAST(g.${q(field)} AS VARCHAR) END`:blank(field)} AS ${q(field)}`);
      const outputMeasures=measures.map(agg=>`${fill?(['SUM','COUNT'].includes(agg.operation)?`COALESCE(a.${q(agg.name)}, 0)`:`a.${q(agg.name)}`):q(agg.name)} AS ${q(agg.name)}`);
      const sort=[...p.partitions.map(field=>`${selectPrefix}${q(field)} NULLS FIRST`),periodValue].join(', ');
      ctes.push(`${q(stage)} AS (SELECT ${[...partitions,`${periodText} AS ${q(p.periodName)}`,...outputMeasures,`ROW_NUMBER() OVER (ORDER BY ${sort}) AS ${q(ordinal)}`].join(', ')} FROM ${result})`);
    } else if(step.op==='between') {
      const valid=p.mode==='numeric'?numericValid(p.field):dateValid(p.field);
      const low=boundValue(p.lower),high=boundValue(p.upper);
      if(parameters) {
        for(const boundInput of [p.lower,p.upper]) if(object(boundInput)) {
          const parameter=parameterByName.get(boundInput.param),expected=p.mode==='numeric'?'number':'text';
          if(parameter?.type!==expected){warning=`Between ${p.mode} mode requires ${expected} bound parameters; ${boundInput.param} is incompatible.`;break;}
        }
      }
      const comparable=value=>p.mode==='numeric'?value:typeof value==='string'?Date.parse(value):NaN;
      const lowerUnknown=object(p.lower)&&!parameters,upperUnknown=object(p.upper)&&!parameters;
      const lowerValue=lowerUnknown?null:comparable(low),upperValue=upperUnknown?null:comparable(high);
      if(!warning&&!lowerUnknown&&!upperUnknown&&(!Number.isFinite(lowerValue)||!Number.isFinite(upperValue))) warning=`Between ${p.mode} bounds must be valid ${p.mode==='date'?'dates':'numbers'}; the result is empty.`;
      if(!warning&&!lowerUnknown&&!upperUnknown&&lowerValue>upperValue) warning='Between lower bound exceeds upper bound; the result is empty.';
      const compare=p.mode==='date'?`TRY_CAST(${q(p.field)} AS TIMESTAMP)`:q(p.field);
      const predicate=warning?'FALSE':`${valid} AND ${compare} >= ${boundSql(p.lower,p.mode)} AND ${compare} <= ${boundSql(p.upper,p.mode)}`;
      ctes.push(`${q(stage)} AS (SELECT ${[...columns.map(q),q(ordinal)].join(', ')} FROM ${q(previous)} WHERE ${predicate})`);
    } else if(step.op==='top') {
      if(orderNeedsCheck) guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      const valid=numericValid(p.field),rawN=integerValue(p.n);
      if(object(p.n)&&parameters) {
        const parameter=parameterByName.get(p.n.param);
        if(parameter?.type!=='number')warning=`Top N parameter ${p.n.param} must be numeric; the result is empty.`;
      }
      if(!warning&&rawN!==undefined&&(!Number.isInteger(rawN)||rawN<1))warning='Top N must be an integer of at least 1; the result is empty.';
      const orderBy=`${q(p.field)} ${p.direction.toUpperCase()}, ${q(ordinal)} ASC`;
      const candidates=warning?`SELECT ${[...columns.map(q),q(ordinal)].join(', ')} FROM ${q(previous)} WHERE FALSE`:`SELECT ${[...columns.map(q),q(ordinal)].join(', ')} FROM ${q(previous)} WHERE ${valid} ORDER BY ${orderBy} LIMIT ${object(p.n)?`{{${p.n.param}}}`:p.n}`;
      ctes.push(`${q(stage)} AS (SELECT ${columns.map(q).join(', ')}, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS ${q(ordinal)} FROM (${candidates}) AS top_rows)`);
    } else if(step.op==='movingAvg') {
      if(orderNeedsCheck) guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      const window=object(p.window)?`{{${p.window.param}}}`:String(p.window);
      const frame=object(p.window)?`(${window} - 1)`:String(p.window-1);
      const partition=p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')} `:'';
      const average=`AVG(CASE WHEN ${numericValid(p.field)} THEN ${q(p.field)} END) OVER (${partition}ORDER BY ${q(ordinal)} ROWS BETWEEN ${frame} PRECEDING AND CURRENT ROW)`;
      ctes.push(`${q(stage)} AS (SELECT ${columns.map(field=>field===p.field?`${average} AS ${q(field)}`:q(field)).join(', ')}, ${q(ordinal)} FROM ${q(previous)})`);
    } else if(step.op==='stats') {
      const valid=numericValid(p.field),value=`CASE WHEN ${valid} THEN CAST(${q(p.field)} AS DOUBLE) END`;
      const aggregateSql=`COUNT(${value}) AS ${q('count')}, MIN(${value}) AS ${q('min')}, MAX(${value}) AS ${q('max')}, AVG(${value}) AS ${q('mean')}, MEDIAN(${value}) AS ${q('median')}, STDDEV_POP(${value}) AS ${q('stddev')}`;
      ctes.push(`${q(stage)} AS (SELECT ${aggregateSql}, 0::BIGINT AS ${q(ordinal)} FROM ${q(previous)})`);
    }
    const exclusions=measures.filter(agg=>agg.exclusion).map(agg=>`(SELECT COUNT(*) FROM ${q(step.op==='bucket'?`${stage}_valid`:previous)} WHERE ${agg.exclusion}) AS ${q('excluded:aggregate:'+agg.name)}`);
    if(step.op==='bucket') exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE TRY_CAST(${q(p.dateField)} AS TIMESTAMP) IS NULL) AS ${q('excluded:invalidDates')}`);
    if(['between','top','movingAvg','stats'].includes(step.op)) {
      const valid=step.op==='between'&&p.mode==='date'?dateValid(p.field):numericValid(p.field);
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE NOT (${valid})) AS ${q('excluded:invalidValues')}`);
    }
    const diagnosticsSql=withSql(ctes,`SELECT (SELECT COUNT(*) FROM ${q(previous)}) AS rowsIn, (SELECT COUNT(*) FROM ${q(stage)}) AS rowsOut${exclusions.length?', '+exclusions.join(', '):''}`);
    if(step.op==='groupBy') {columns=names;types=Object.fromEntries([...p.groups.map(field=>[field,'Utf8']),...measures.map(agg=>[agg.name,agg.type])]);ordered=true;orderNeedsCheck=false;}
    else if(step.op==='bucket') {columns=names;types=Object.fromEntries([...p.partitions.map(field=>[field,'Utf8']),[p.periodName,'Utf8'],...measures.map(agg=>[agg.name,agg.type])]);ordered=true;orderNeedsCheck=false;}
    else if(step.op==='movingAvg') types={...types,[p.field]:'Float64'};
    else if(step.op==='stats') {columns=statColumns;types={count:'Int64',min:'Float64',max:'Float64',mean:'Float64',median:'Float64',stddev:'Float64'};ordered=true;orderNeedsCheck=false;}
    else if(step.op==='top') {ordered=true;orderNeedsCheck=false;}
    steps.push({...step,disabled:false,reason:null,warning,inputSql,sql:withSql(ctes,output(stage)),diagnosticsSql,inputColumns,columns:[...columns],types:{...types}});
    previous=stage;
  }
  const errors=steps.filter(step=>step.disabled).map(step=>`${step.id}: ${step.reason}`);
  for(const column of Object.values(chain.outputMapping)) if(!columns.includes(column)) errors.push(`Output mapping column ${column} is unavailable.`);
  const sql=errors.length?null:withSql(ctes,output(previous));
  if(sql?.length>100000) fail('Compiled transform SQL exceeds the 100,000 character query limit.');
  return {chain,sql,columns,types,steps,guards,errors,parameterDependencies};
}
