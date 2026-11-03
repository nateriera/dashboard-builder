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
function periodWindow(input,label) {
  if(!object(input)) fail(`Invalid ${label} period window.`);
  if(input.kind==='relative') {
    shape(input,['kind','days'],`${label} relative window`);
    const days=parameterReference(input.days,`${label} window length`)||input.days;
    if(typeof days==='number'&&(!Number.isSafeInteger(days)||days<1)) fail(`${label} window length must be a positive integer.`);
    if(typeof days!=='number'&&!object(days)) fail(`${label} window length must be an integer or parameter reference.`);
    return {kind:'relative',days};
  }
  if(input.kind==='range') {
    shape(input,['kind','start','end'],`${label} date range`);
    return {kind:'range',start:bound(input.start,'date',`${label} start`),end:bound(input.end,'date',`${label} end`)};
  }
  fail(`${label} window must be relative or a date range.`);
}
function ratioOperand(input,label) {
  if(!object(input)) fail(`Invalid ratio ${label} operand.`);
  if(input.kind==='field') {
    shape(input,['kind','field'],`ratio ${label} field`);
    return {kind:'field',field:name(input.field,`${label} field`)};
  }
  if(input.kind==='aggregate') {
    shape(input,['kind','column','operation'],`ratio ${label} aggregate`);
    const operation=String(input.operation||'SUM').toUpperCase();
    if(!['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'].includes(operation)) fail(`Invalid ratio ${label} aggregate.`);
    const column=input.column==null||input.column===''?null:name(input.column,`${label} field`);
    if(operation!=='COUNT'&&!column) fail(`Ratio ${label} ${operation} needs a field.`);
    return {kind:'aggregate',column,operation};
  }
  fail(`Invalid ratio ${label} operand.`);
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
    const values=[params.grain,params.lower,params.upper,params.n,params.window,params.min,params.max];
    for(const window of [params.currentWindow,params.previousWindow]) if(object(window)) values.push(window.days,window.start,window.end);
    return values.filter(object).map(reference=>reference.param);
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
  if(source.sql) {
    if(source.sql.includes('__DASHBOARD_BUILDER_APP_LOCAL_DATE__')) fail('Transform source SQL uses a reserved execution-date marker.');
    prepareStatement(source.sql);rawParameterNames(source.sql);
  }
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
    if(step.op==='cumulative') {
      shape(step.params,['field','partitions'],'Cumulative parameters');
      return {id:step.id,op:step.op,params:{field:name(step.params.field),partitions:fields(step.params.partitions||[],'partition fields')}};
    }
    if(step.op==='change') {
      shape(step.params,['currentField','previousField','outputName'],'Change parameters');
      return {id:step.id,op:step.op,params:{currentField:name(step.params.currentField),previousField:name(step.params.previousField),outputName:name(step.params.outputName,'output name')}};
    }
    if(step.op==='periodPair') {
      if(object(step.params)&&['source','source2','previousSource','otherSource','dataset','dataset2'].some(key=>own(step.params,key))) fail('periodPair cannot name a second source.');
      shape(step.params,['dateField','categoryField','measureField','aggregate','currentWindow','previousWindow','outputCurrent','outputPrevious'],'periodPair parameters');
      const aggregate=step.params.aggregate||'SUM';
      if(!['SUM','COUNT','AVG'].includes(aggregate)) fail('periodPair aggregate must be SUM, COUNT, or AVG.');
      return {id:step.id,op:step.op,params:{
        dateField:name(step.params.dateField),
        categoryField:step.params.categoryField==null||step.params.categoryField===''?null:name(step.params.categoryField),
        measureField:name(step.params.measureField),aggregate,
        currentWindow:periodWindow(step.params.currentWindow,'Current'),
        previousWindow:step.params.previousWindow==null?null:periodWindow(step.params.previousWindow,'Previous'),
        outputCurrent:name(step.params.outputCurrent||'current','current output name'),
        outputPrevious:name(step.params.outputPrevious||'previous','previous output name')
      }};
    }
    if(step.op==='pivot') {
      shape(step.params,['rowFields','columnField','measureField','aggregate'],'Pivot parameters');
      const rowFields=fields(step.params.rowFields,'Pivot row fields');
      if(!rowFields.length) fail('Pivot needs at least one row key field.');
      const columnField=name(step.params.columnField,'Pivot column field');
      const aggregate=String(step.params.aggregate||'SUM').toUpperCase();
      if(!['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'].includes(aggregate)) fail('Invalid Pivot aggregate.');
      const measureField=step.params.measureField==null||step.params.measureField===''?null:name(step.params.measureField,'Pivot measure field');
      if(aggregate!=='COUNT'&&!measureField) fail(`Pivot ${aggregate} needs a measure field.`);
      if(new Set([...rowFields,columnField,...(measureField?[measureField]:[])]).size!==rowFields.length+1+(measureField?1:0)) fail('Pivot row, column, and measure roles must use distinct fields.');
      return {id:step.id,op:step.op,params:{rowFields,columnField,measureField,aggregate}};
    }
    if(step.op==='histogram') {
      shape(step.params,['field','bins','min','max'],'Histogram parameters');
      const bins=step.params.bins??20;
      if(!Number.isSafeInteger(bins)||bins<1||bins>500) fail('Histogram bins must be an integer from 1 to 500.');
      const histogramBound=input=>{
        if(input==null)return null;
        const reference=parameterReference(input,'Histogram bound');
        if(reference)return reference;
        if(typeof input==='number')return input;
        fail('Histogram bounds must be numbers or numeric parameter references.');
      };
      const min=histogramBound(step.params.min),max=histogramBound(step.params.max);
      return {id:step.id,op:step.op,params:{field:name(step.params.field),bins,min,max}};
    }
    if(step.op==='ratio') {
      shape(step.params,['numerator','denominator','partitions','percent','outputName'],'Ratio parameters');
      if(step.params.percent!=null&&typeof step.params.percent!=='boolean') fail('Ratio percent must be a boolean.');
      return {id:step.id,op:step.op,params:{
        numerator:ratioOperand(step.params.numerator,'numerator'),
        denominator:ratioOperand(step.params.denominator,'denominator'),
        partitions:fields(step.params.partitions||[],'partition fields'),
        percent:step.params.percent===true,
        outputName:name(step.params.outputName||'ratio','output name')
      }};
    }
    fail(`Unsupported transform operation: ${step.op}.`);
  });
  if(!object(input.outputMapping)||Object.keys(input.outputMapping).length>LIMITS.columns) fail('Invalid transform output mapping.');
  const outputMapping=Object.fromEntries(Object.entries(input.outputMapping).map(([key,column])=>[name(key,'mapping field'),name(column,'mapping column')]));
  const chain={version:1,source:{...(source.table?{table:name(source.table,'table')}:{sql:source.sql}),dependencies:dependencies&&[...dependencies],schema:{columns,types},order},steps,outputMapping};
  if(parameters!==undefined) {
    const existing=new Map(validateParameters(parameters).map(parameter=>[parameter.name,parameter]));
    for(const dependency of transformParameterDependencies(chain)) if(!existing.has(dependency)) fail(`Unknown transform parameter: ${dependency}.`);
    for(const step of steps) if(step.op==='between') {
      const {mode,lower,upper}=step.params;
      const lowerParameter=object(lower)?existing.get(lower.param):null,upperParameter=object(upper)?existing.get(upper.param):null;
      const rangeType=mode==='numeric'?'number-range':'date-range';
      if(lowerParameter?.type?.endsWith('-range')||upperParameter?.type?.endsWith('-range')) {
        if(lower.param!==upper.param||lowerParameter?.type!==rangeType||upperParameter?.type!==rangeType) fail(`Between ${mode} range bounds must both reference the same ${rangeType} parameter.`);
      }
    }
    for(const step of steps) if(object(step.params.grain)&&existing.get(step.params.grain.param)?.type!=='text') fail(`Bucket parameter ${step.params.grain.param} must be text.`);
    for(const step of steps) if(step.op==='periodPair') {
      for(const window of [step.params.currentWindow,step.params.previousWindow].filter(Boolean)) {
      if(window.kind==='relative'&&object(window.days)&&existing.get(window.days.param)?.type!=='number') fail(`periodPair window parameter ${window.days.param} must be numeric.`);
        if(window.kind==='range') for(const bound of [window.start,window.end]) if(object(bound)&&existing.get(bound.param)?.type!=='text') fail(`periodPair date parameter ${bound.param} must be text.`);
      }
    }
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
const textLiteral=value=>`'${String(value).replaceAll("'","''")}'`;
function pivotColumnBase(value) {
  const raw=value==null?'null':String(value);
  const slug=raw.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase().slice(0,72)||'value';
  return `pivot_${slug}`;
}
function pivotColumns(categories,rowFields) {
  const used=new Set(rowFields.map(field=>field.toLowerCase()));
  return categories.map((category,index)=>{
    const base=pivotColumnBase(category.label),stem=base;
    let suffix=1,column=stem;
    while(used.has(column.toLowerCase())) column=`${stem}__${++suffix}`;
    used.add(column.toLowerCase());
    return {...category,column,index};
  });
}
function pivotAggregate(p,types,condition) {
  const q=quoteIdentifier,field=p.measureField&&q(p.measureField),type=field?types[p.measureField]||'Unknown':'';
  if(p.aggregate==='COUNT') return `COUNT(*) FILTER (WHERE ${condition})`;
  if(p.aggregate==='COUNT DISTINCT') return `COUNT(DISTINCT CASE WHEN ${condition} AND ${field} IS NOT NULL THEN ${field} END)`;
  const valid=numeric(type)?numericValidSql(p.measureField):'FALSE';
  const value=`CASE WHEN ${condition} AND ${valid} THEN ${field} END`;
  const expression=`${p.aggregate}(${value})`;
  if(p.aggregate==='SUM') {
    const integer=/^(?:U?Int|U?TinyInt|U?SmallInt|U?BigInt|Integer)/i.test(type);
    const unsigned=/^U/i.test(type);
    const exact=integer?`CAST(${expression} AS ${unsigned?'UBIGINT':'BIGINT'})`:expression;
    return `COALESCE(${exact}, 0)`;
  }
  return expression;
}
const numericValidSql=field=>`(${quoteIdentifier(field)} IS NOT NULL AND isfinite(${quoteIdentifier(field)}))`;

/** Builds the true wide reshape for chain op `pivot`. Runtime categories are
 * supplied only by preview execution; they never enter the saved chain. */
export function compilePivotTransformStep({stage,previous,params,types,ordinal,categories}) {
  const q=quoteIdentifier,groupFields=params.rowFields.map(q),groupSql=groupFields.join(', ');
  if(categories===undefined) {
    const measure=params.measureField?`, ${q(params.measureField)}`:'';
    const aggregate=params.aggregate==='COUNT'?`COUNT(${q(ordinal)})`:params.aggregate==='COUNT DISTINCT'?`COUNT(DISTINCT ${q(params.measureField)})`:`${params.aggregate}(${q(params.measureField)})`;
    const source=`SELECT ${groupSql}, MIN(${q(ordinal)}) OVER (PARTITION BY ${groupSql}) AS ${q(ordinal)}, CAST(${q(params.columnField)} AS VARCHAR) AS ${q('__pivot_value')}${measure} FROM ${q(previous)}`;
    return {sql:`PIVOT (${source}) ON ${q('__pivot_value')} USING ${aggregate} GROUP BY ${groupSql}, ${q(ordinal)}`,columns:[...params.rowFields],types:Object.fromEntries(params.rowFields.map(field=>[field,types[field]])),outputMetadata:{rowFields:[...params.rowFields],columnField:params.columnField,measureField:params.measureField,aggregate:params.aggregate,categories:null}};
  }
  const resolved=pivotColumns(categories,params.rowFields);
  const expressions=resolved.map(category=>{
    const condition=category.label==null?`CAST(${q(params.columnField)} AS VARCHAR) IS NULL`:`CAST(${q(params.columnField)} AS VARCHAR) IS NOT DISTINCT FROM ${textLiteral(category.label)}`;
    return `${pivotAggregate(params,types,condition)} AS ${q(category.column)}`;
  });
  const sql=`SELECT ${groupSql}, MIN(${q(ordinal)}) AS ${q(ordinal)}${expressions.length?', '+expressions.join(', '):''} FROM ${q(previous)} GROUP BY ${groupSql}`;
  const aggregateType=params.aggregate==='COUNT'||params.aggregate==='COUNT DISTINCT'?'Int64':params.aggregate==='SUM'&&/^(?:U?Int|U?TinyInt|USmallInt|SmallInt|UBigInt|BigInt|Integer)/i.test(types[params.measureField]||'')?(/^U/i.test(types[params.measureField])?'Uint64':'Int64'):'Float64';
  return {sql,columns:[...params.rowFields,...resolved.map(category=>category.column)],types:{...Object.fromEntries(params.rowFields.map(field=>[field,types[field]])),...Object.fromEntries(resolved.map(category=>[category.column,aggregateType]))},outputMetadata:{rowFields:[...params.rowFields],columnField:params.columnField,measureField:params.measureField,aggregate:params.aggregate,categories:resolved.map(({value,label,column,index,firstSeen})=>({value,label,column,firstSeen:firstSeen??index}))}};
}

function compileHistogramTransformStep({stage,previous,params,ordinal,boundsInvalid}) {
  const q=quoteIdentifier,field=q(params.field),valid=numericValidSql(params.field);
  const lo=params.min==null?'data_min':object(params.min)?`{{${params.min.param}}}`:String(params.min);
  const hi=params.max==null?'data_max':object(params.max)?`{{${params.max.param}}}`:String(params.max);
  const ctes=[];
  ctes.push(`${q(`${stage}_valid`)} AS (SELECT CAST(${field} AS DOUBLE) AS value FROM ${q(previous)} WHERE ${valid})`);
  ctes.push(`${q(`${stage}_range`)} AS (SELECT MIN(value) AS data_min, MAX(value) AS data_max FROM ${q(`${stage}_valid`)})`);
  const lowExpr=boundsInvalid?'NULL::DOUBLE':params.min==null?'data_min':lo,highExpr=boundsInvalid?'NULL::DOUBLE':params.max==null?'data_max':hi;
  const bounds=`${q(`${stage}_range`)} r`;
  const width=`CASE WHEN (${lowExpr}) = (${highExpr}) THEN 1.0 ELSE ((${highExpr}) - (${lowExpr})) END`;
  const start=`CASE WHEN (${lowExpr}) = (${highExpr}) THEN (${lowExpr}) - 0.5 ELSE (${lowExpr}) END`;
  const end=`CASE WHEN (${lowExpr}) = (${highExpr}) THEN (${highExpr}) + 0.5 ELSE (${highExpr}) END`;
  const binCount=`CASE WHEN (${lowExpr}) = (${highExpr}) THEN 1 ELSE ${params.bins} END`;
  const validBounds=`${lowExpr} IS NOT NULL AND ${highExpr} IS NOT NULL AND ${lowExpr} <= ${highExpr}`;
  const bins=`${q(`${stage}_bins`)}`;
  ctes.push(`${bins} AS (SELECT i::BIGINT AS bin_index, ${binCount}::BIGINT AS bin_count, ${start} + ${width} * i / ${binCount} AS bin_start, ${start} + ${width} * (i + 1) / ${binCount} AS bin_end FROM ${bounds}, LATERAL range(0, CAST(${binCount} AS BIGINT)) AS bins(i) WHERE ${validBounds} AND NOT ${boundsInvalid?'TRUE':'FALSE'})`);
  const sql=`WITH ${ctes.join(', ')} SELECT CAST(b.bin_index + 1 AS VARCHAR) AS ${q('key')}, COUNT(v.value)::BIGINT AS ${q('value')}, b.bin_start AS ${q('start')}, b.bin_end AS ${q('end')}, b.bin_index AS ${q(ordinal)} FROM ${bins} b LEFT JOIN ${q(`${stage}_valid`)} v ON v.value >= b.bin_start AND (v.value < b.bin_end OR (b.bin_index = b.bin_count - 1 AND v.value <= b.bin_end)) GROUP BY b.bin_index, b.bin_count, b.bin_start, b.bin_end`;
  return {sql,columns:['key','value','start','end'],types:{key:'Utf8',value:'Int64',start:'Float64',end:'Float64'}};
}
const withSql=(ctes,select)=>`WITH ${ctes.join(',\n')}\n${select}`;

export function compileTransformChain(input,options={}) {
  const chain=validateTransformChain(input,options);
  const parameterDependencies=transformParameterDependencies(chain);
  const parameters=options.parameters===undefined?null:validateParameters(options.parameters);
  const parameterByName=new Map((parameters||[]).map(parameter=>[parameter.name,parameter]));
  let columns=[...chain.source.schema.columns],types={...chain.source.schema.types},dynamicOutput=false;
  const statColumns=['count','min','max','mean','median','stddev'];
  const allNames=[...columns,...chain.steps.flatMap(step=>[...(step.params.aggregations||[]).map(agg=>agg.name),step.params.periodName,...(step.op==='stats'?statColumns:[]),step.params.outputName,step.params.outputCurrent,step.params.outputPrevious].filter(Boolean))].map(name=>name.toLowerCase());
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
  const output=(name,cols=columns,dynamic=dynamicOutput)=>dynamic?`SELECT * EXCLUDE (${q(ordinal)}) FROM ${q(name)} ORDER BY ${q(ordinal)}`:`SELECT ${cols.map(q).join(', ')} FROM ${q(name)} ORDER BY ${q(ordinal)}`;
  const numericValid=field=>`(${q(field)} IS NOT NULL AND isfinite(${q(field)}))`;
  const dateValid=field=>`TRY_CAST(${q(field)} AS TIMESTAMP) IS NOT NULL`;
  const isDate=type=>/DATE|TIMESTAMP|CHAR|STRING|UTF8|UNKNOWN|NULL/i.test(type||'');
  const boundValue=(input,endpoint)=>{
    if(!object(input)) return input;
    const parameter=parameterByName.get(input.param);
    return parameter?.type?.endsWith('-range')?parameter.value[endpoint]:parameter?.value;
  };
  const boundSql=(input,mode,endpoint)=>{
    const parameter=object(input)?parameterByName.get(input.param):null;
    const rangeValue=parameter?.type?.endsWith('-range')?parameter.value[endpoint]:undefined;
    if(rangeValue===null) return null;
    const raw=rangeValue!==undefined?(mode==='date'?literal(rangeValue):String(rangeValue)):object(input)?`{{${input.param}}}`:mode==='date'?literal(input):String(input);
    return mode==='date'?`TRY_CAST(${raw} AS TIMESTAMP)`:raw;
  };
  const integerValue=input=>object(input)?parameterByName.get(input.param)?.value:input;
  const dateBoundSql=input=>object(input)?`TRY_CAST('{{${input.param}}}' AS DATE)`:`TRY_CAST(${literal(input)} AS DATE)`;
  const daysSql=value=>object(value)?`CAST({{${value.param}}} AS BIGINT)`:String(value);
  const relativeBounds=(window,endExpression)=>{
    const days=daysSql(window.days),end=endExpression||`CAST('__DASHBOARD_BUILDER_APP_LOCAL_DATE__' AS DATE)`;
    return {start:`(${end} - (${days} - 1) * INTERVAL 1 DAY)`,end};
  };
  const rangeBounds=window=>({start:dateBoundSql(window.start),end:dateBoundSql(window.end)});
  const explicitDateValue=input=>object(input)?parameterByName.get(input.param)?.value:input;
  for(const [index,step] of chain.steps.entries()) {
    const p=step.params,params=p.aggregations||[];
    const ratioFields=operand=>operand.kind==='field'?[operand.field]:operand.column?[operand.column]:[];
    const inputs=step.op==='groupBy'?[...p.groups,...params.map(agg=>agg.column).filter(Boolean)]:step.op==='bucket'?[p.dateField,...p.partitions,...params.map(agg=>agg.column).filter(Boolean)]:step.op==='stats'||step.op==='histogram'?[p.field]:step.op==='movingAvg'||step.op==='cumulative'?[p.field,...p.partitions]:step.op==='change'?[p.currentField,p.previousField]:step.op==='periodPair'?[p.dateField,...(p.categoryField?[p.categoryField]:[]),p.measureField]:step.op==='pivot'?[...p.rowFields,p.columnField,...(p.measureField?[p.measureField]:[])]:step.op==='ratio'?[...ratioFields(p.numerator),...ratioFields(p.denominator),...p.partitions]:[p.field];
    const pivotRuntime=options.pivotCategories?.[step.id];
    const pivotResolved=step.op==='pivot'&&Array.isArray(pivotRuntime)?pivotColumns(pivotRuntime,p.rowFields):null;
    const missing=inputs.find(field=>!columns.includes(field));
    const names=step.op==='groupBy'?[...p.groups,...params.map(agg=>agg.name)]:step.op==='bucket'?[...p.partitions,p.periodName,...params.map(agg=>agg.name)]:step.op==='stats'?statColumns:step.op==='periodPair'?[...(p.categoryField?[p.categoryField]:[]),p.outputCurrent,p.outputPrevious]:step.op==='change'?[...columns,p.outputName]:step.op==='pivot'?[...p.rowFields,...(pivotResolved||[]).map(category=>category.column)]:step.op==='histogram'?['key','value','start','end']:step.op==='ratio'?[...columns,p.outputName]:[...columns];
    let reason=blocked?'A preceding step is disabled.':missing?`Input column ${missing} is unavailable after the preceding step.`:'';
    if(!reason&&step.op==='pivot'&&Array.isArray(pivotRuntime)&&pivotRuntime.length>24) reason='Pivot has at least 25 distinct column categories; the limit is 24.';
    let warning=null,cumulativeInvalidSql=null,periodCurrentPredicate=null,periodPreviousPredicate=null,pivotCategorySql=null,pivotOutputMetadata=null,ratioDiagnosticSql=null;
    if(!reason&&new Set(names.map(name=>name.toLowerCase())).size!==names.length) reason='Transform output column names must be unique.';
    const orderSensitive=step.op==='top'||step.op==='movingAvg'||step.op==='cumulative'||step.op==='groupBy'&&p.groups.length>0||step.op==='periodPair'&&!!p.categoryField||step.op==='pivot';
    if(!reason&&orderSensitive&&!ordered) reason=`${step.op==='groupBy'?'GroupBy':step.op==='movingAvg'?'MovingAvg':step.op==='periodPair'?'periodPair':step.op==='pivot'?'Pivot':'Cumulative/Top'} needs a deterministic incoming order. Choose source order fields.`;
    if(!reason&&step.op==='bucket'&&!isDate(types[p.dateField])) reason='Bucket requires a date, timestamp, or date-string column.';
    if(!reason&&step.op==='bucket'&&object(p.grain)&&options.parameters!==undefined) {
      const parameter=parameterByName.get(p.grain.param);
      if(parameter?.type!=='text'||!['day','week','month'].includes(parameter.value)) reason=`Bucket parameter ${p.grain.param} must be text with value day, week, or month.`;
    }
    if(!reason&&step.op==='between'&&(p.mode==='numeric'?!numeric(types[p.field]):!isDate(types[p.field]))) reason=`Between ${p.mode} mode is incompatible with ${types[p.field]||'unknown'} column ${p.field}.`;
    if(!reason&&(step.op==='top'||step.op==='movingAvg'||step.op==='stats')&&!numeric(types[p.field])) reason=`${step.op==='top'?'Top':step.op==='movingAvg'?'MovingAvg':'Stats'} requires a numeric column.`;
    if(!reason&&step.op==='change'&&(!numeric(types[p.currentField])||!numeric(types[p.previousField]))) reason='Change requires numeric current and previous columns.';
    if(!reason&&step.op==='periodPair'&&!isDate(types[p.dateField])) reason='periodPair requires a date, timestamp, or date-string column.';
    if(!reason&&step.op==='periodPair'&&p.aggregate!=='COUNT'&&!numeric(types[p.measureField])) reason=`periodPair ${p.aggregate} requires a numeric measure column.`;
    if(!reason&&step.op==='pivot'&&!['COUNT','COUNT DISTINCT'].includes(p.aggregate)&&!numeric(types[p.measureField])) reason=`Pivot ${p.aggregate} requires a numeric measure column.`;
    if(!reason&&step.op==='histogram'&&!numeric(types[p.field])) reason='Histogram requires a numeric column.';
    if(!reason&&step.op==='ratio') for(const [label,operand] of [['numerator',p.numerator],['denominator',p.denominator]]) if((operand.kind==='field'||!['COUNT','COUNT DISTINCT'].includes(operand.operation))&&!numeric(types[operand.kind==='field'?operand.field:operand.column])) {reason=`Ratio ${label} requires a numeric field.`;break;}
    if(!reason&&step.op==='histogram'&&options.parameters!==undefined) for(const [label,boundInput] of [['minimum',p.min],['maximum',p.max]]) if(object(boundInput)&&parameterByName.get(boundInput.param)?.type!=='number') {reason=`Histogram ${label} parameter ${boundInput.param} must be numeric.`;break;}
    if(!reason&&step.op==='periodPair'&&p.currentWindow.kind==='relative'&&object(p.currentWindow.days)&&options.parameters!==undefined) {
      const parameter=parameterByName.get(p.currentWindow.days.param);
      if(parameter?.type!=='number'||!Number.isSafeInteger(parameter.value)||parameter.value<1) reason=`periodPair window parameter ${p.currentWindow.days.param} must be a numeric integer of at least 1.`;
    }
    if(!reason&&step.op==='periodPair'&&p.previousWindow?.kind==='relative'&&object(p.previousWindow.days)&&options.parameters!==undefined) {
      const parameter=parameterByName.get(p.previousWindow.days.param);
      if(parameter?.type!=='number'||!Number.isSafeInteger(parameter.value)||parameter.value<1) reason=`periodPair window parameter ${p.previousWindow.days.param} must be a numeric integer of at least 1.`;
    }
    if(!reason&&step.op==='movingAvg'&&object(p.window)) {
      const parameter=parameterByName.get(p.window.param);
      if(options.parameters!==undefined&&(parameter?.type!=='number'||!Number.isInteger(parameter.value)||parameter.value<1)) reason=`MovingAvg window ${p.window.param} must be a numeric integer of at least 1.`;
    }
    const inputSql=withSql(ctes,output(previous));
    if(reason) {steps.push({...step,disabled:true,reason,inputSql,sql:null,diagnosticsSql:null,inputColumns:[...columns],columns:[...columns]});blocked=true;continue;}
    const stage=`${prefix}_${index+1}`,inputColumns=[...columns];
    const measures=params.map(agg=>({...agg,...aggregateSql(agg,types)}));
    if(step.op==='cumulative') {
      if(orderNeedsCheck) guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      const isNumeric=numeric(types[p.field]),valid=isNumeric?numericValid(p.field):'FALSE';
      cumulativeInvalidSql=`NOT (${valid})`;
      const integer=/^(?:U?Int|U?TinyInt|U?SmallInt|U?BigInt|Integer)/i.test(types[p.field]||'');
      const unsigned=/^(?:UInt|UTinyInt|USmallInt|UInteger|UBigInt)/i.test(types[p.field]||'');
      const cast=integer?(unsigned?'UBIGINT':'BIGINT'):'DOUBLE',outType=integer?(unsigned?'Uint64':'Int64'):'Float64';
      const value=`CASE WHEN ${valid} THEN CAST(${q(p.field)} AS ${cast}) ELSE 0::${cast} END`;
      const partition=p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')} `:'';
      const running=`SUM(${value}) OVER (${partition}ORDER BY ${q(ordinal)} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
      ctes.push(`${q(stage)} AS (SELECT ${columns.map(field=>field===p.field?`${running} AS ${q(field)}`:q(field)).join(', ')}, ${q(ordinal)} FROM ${q(previous)})`);
      types={...types,[p.field]:outType};
    } else if(step.op==='change') {
      const currentValid=numericValid(p.currentField),previousValid=numericValid(p.previousField);
      const change=`CASE WHEN ${currentValid} AND ${previousValid} AND ${q(p.previousField)} <> 0 THEN ((${q(p.currentField)} - ${q(p.previousField)}) / ABS(${q(p.previousField)})) * 100 ELSE NULL::DOUBLE END`;
      ctes.push(`${q(stage)} AS (SELECT ${columns.map(q).join(', ')}, ${change} AS ${q(p.outputName)}, ${q(ordinal)} FROM ${q(previous)})`);
      columns=[...columns,p.outputName];types={...types,[p.outputName]:'Float64'};
    } else if(step.op==='periodPair') {
      if(orderNeedsCheck&&p.categoryField) guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      const current=p.currentWindow.kind==='relative'?relativeBounds(p.currentWindow):rangeBounds(p.currentWindow);
      let prior;
      if(p.previousWindow?.kind==='range') prior=rangeBounds(p.previousWindow);
      else if(p.previousWindow?.kind==='relative') prior=relativeBounds(p.previousWindow,`(${current.start} - INTERVAL 1 DAY)`);
      else if(p.currentWindow.kind==='relative') prior=relativeBounds({days:p.currentWindow.days},`(${current.start} - INTERVAL 1 DAY)`);
      else {
        const span=`(date_diff('day', ${current.start}, ${current.end}) + 1)`;
        const priorEnd=`(${current.start} - INTERVAL 1 DAY)`;
        prior={end:priorEnd,start:`(${priorEnd} - (${span} - 1) * INTERVAL 1 DAY)`};
      }
      const date=`TRY_CAST(${q(p.dateField)} AS DATE)`;
      const inCurrent=`(${date} >= ${current.start} AND ${date} <= ${current.end})`;
      const inPrevious=`(${date} >= ${prior.start} AND ${date} <= ${prior.end})`;
      periodCurrentPredicate=inCurrent;periodPreviousPredicate=inPrevious;
      for(const window of [p.currentWindow,p.previousWindow].filter(Boolean)) if(window.kind==='range') {
        const start=explicitDateValue(window.start),end=explicitDateValue(window.end);
        const startUnknown=object(window.start)&&!parameters,endUnknown=object(window.end)&&!parameters;
        const startTime=typeof start==='string'?Date.parse(start):NaN,endTime=typeof end==='string'?Date.parse(end):NaN;
        if(!warning&&!startUnknown&&!endUnknown&&(!Number.isFinite(startTime)||!Number.isFinite(endTime)))warning='periodPair date range contains an invalid date; the result is empty.';
        else if(!warning&&!startUnknown&&!endUnknown&&startTime>endTime)warning='periodPair date range start exceeds its end; the result is empty.';
      }
      const validMeasure=p.aggregate==='COUNT'?'TRUE':numericValid(p.measureField);
      const integerMeasure=/^(?:U?Int|U?TinyInt|U?SmallInt|U?BigInt|Integer)/i.test(types[p.measureField]||'');
      const unsignedMeasure=/^(?:UInt|UTinyInt|USmallInt|UInteger|UBigInt)/i.test(types[p.measureField]||'');
      const sumType=integerMeasure?(unsignedMeasure?'UBIGINT':'BIGINT'):'DOUBLE';
      const periodMeasure=predicate=>{
        if(p.aggregate==='COUNT') return `COUNT(*) FILTER (WHERE ${predicate})`;
        const valueType=p.aggregate==='SUM'?sumType:'DOUBLE';
        const aggregate=`${p.aggregate}(CASE WHEN ${predicate} AND ${validMeasure} THEN CAST(${q(p.measureField)} AS ${valueType}) END)`;
        return p.aggregate==='SUM'?`COALESCE(${integerMeasure?`CAST(${aggregate} AS ${sumType})`:aggregate}, 0::${sumType})`:aggregate;
      };
      const currentMeasure=periodMeasure(inCurrent),previousMeasure=periodMeasure(inPrevious);
      const expressions=[currentMeasure,previousMeasure];
      const aggregateColumns=[`${expressions[0]} AS ${q(p.outputCurrent)}`,`${expressions[1]} AS ${q(p.outputPrevious)}`];
      const category=p.categoryField;
      const group=category?` GROUP BY ${q(category)}`:'';
      const rowOrder=category?`COALESCE(MIN(${q(ordinal)}), 0)`:'0::BIGINT';
      const where=warning?'FALSE':`(${inCurrent} OR ${inPrevious})`;
      ctes.push(`${q(stage)} AS (SELECT ${[...(category?[q(category)]:[]),...aggregateColumns,`${rowOrder} AS ${q(ordinal)}`].join(', ')} FROM ${q(previous)} WHERE ${where}${group})`);
      columns=[...(category?[category]:[]),p.outputCurrent,p.outputPrevious];
      const aggregateType=p.aggregate==='COUNT'?'Int64':p.aggregate==='SUM'&&integerMeasure?(unsignedMeasure?'Uint64':'Int64'):'Float64';
      types={...(category?{[category]:types[category]}:{}),[p.outputCurrent]:aggregateType,[p.outputPrevious]:aggregateType};
      ordered=true;orderNeedsCheck=false;
    } else if(step.op==='groupBy') {
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
      const low=boundValue(p.lower,'from'),high=boundValue(p.upper,'to');
      if(parameters) {
        for(const boundInput of [p.lower,p.upper]) if(object(boundInput)) {
          const parameter=parameterByName.get(boundInput.param),expected=p.mode==='numeric'?'number':'text';
          const rangeExpected=p.mode==='numeric'?'number-range':'date-range';
          if(parameter?.type!==expected&&parameter?.type!==rangeExpected&&!(p.mode==='date'&&parameter?.type==='date')){warning=`Between ${p.mode} mode requires ${expected} or paired ${rangeExpected} bound parameters; ${boundInput.param} is incompatible.`;break;}
        }
      }
      const comparable=value=>p.mode==='numeric'?value:typeof value==='string'?Date.parse(value):NaN;
      const lowerUnknown=object(p.lower)&&!parameters,upperUnknown=object(p.upper)&&!parameters;
      const lowerOpen=low===null,upperOpen=high===null;
      const lowerValue=lowerUnknown||lowerOpen?null:comparable(low),upperValue=upperUnknown||upperOpen?null:comparable(high);
      if(!warning&&!lowerUnknown&&!upperUnknown&&(!lowerOpen&&!Number.isFinite(lowerValue)||!upperOpen&&!Number.isFinite(upperValue))) warning=`Between ${p.mode} bounds must be valid ${p.mode==='date'?'dates':'numbers'}; the result is empty.`;
      if(!warning&&!lowerUnknown&&!upperUnknown&&!lowerOpen&&!upperOpen&&lowerValue>upperValue) warning='Between lower bound exceeds upper bound; the result is empty.';
      const compare=p.mode==='date'?`TRY_CAST(${q(p.field)} AS TIMESTAMP)`:q(p.field);
      const comparisons=[!lowerOpen?`${compare} >= ${boundSql(p.lower,p.mode,'from')}`:null,!upperOpen?`${compare} <= ${boundSql(p.upper,p.mode,'to')}`:null].filter(Boolean);
      const predicate=warning?'FALSE':`${valid}${comparisons.length?` AND ${comparisons.join(' AND ')}`:''}`;
      ctes.push(`${q(stage)} AS (SELECT ${[...columns.map(q),q(ordinal)].join(', ')} FROM ${q(previous)} WHERE ${predicate})`);
    } else if(step.op==='pivot') {
      if(orderNeedsCheck) guards.push({stepId:step.id,sql:withSql(ctes,`SELECT COUNT(*) AS ambiguousOrder FROM (SELECT 1 FROM ${q(previous)} GROUP BY ${order.fields.map(q).join(', ')} HAVING COUNT(*) > 1) AS ambiguous`),reason:'The chosen source order fields do not uniquely order the rows. Add a tie-break field.'});
      pivotCategorySql=withSql(ctes,`SELECT ${q(p.columnField)} AS value, CAST(${q(p.columnField)} AS VARCHAR) AS label, MIN(${q(ordinal)}) AS firstSeen FROM ${q(previous)} GROUP BY ${q(p.columnField)} ORDER BY MIN(${q(ordinal)}) LIMIT 25`);
      const compiled=compilePivotTransformStep({stage,previous,params:p,types,ordinal,categories:Array.isArray(pivotRuntime)?pivotRuntime:undefined});
      ctes.push(`${q(stage)} AS (${compiled.sql})`);
      columns=compiled.columns;types=compiled.types;dynamicOutput=!Array.isArray(pivotRuntime);ordered=true;orderNeedsCheck=false;pivotOutputMetadata=compiled.outputMetadata;
    } else if(step.op==='histogram') {
      const rawMin=boundValue(p.min),rawMax=boundValue(p.max),minUnknown=object(p.min)&&!parameters,maxUnknown=object(p.max)&&!parameters;
      if(parameters) for(const [label,boundInput] of [['minimum',p.min],['maximum',p.max]]) if(object(boundInput)) {const parameter=parameterByName.get(boundInput.param);if(parameter?.type!=='number'){warning=`Histogram ${label} parameter ${boundInput.param} must be numeric; the result is empty.`;break;}}
      const minValue=p.min==null?null:minUnknown?null:rawMin,maxValue=p.max==null?null:maxUnknown?null:rawMax;
      const boundsInvalid=!warning&&(!minUnknown&&!maxUnknown&&((p.min!=null&&!Number.isFinite(minValue))||(p.max!=null&&!Number.isFinite(maxValue))||(p.min!=null&&p.max!=null&&minValue>maxValue)));
      if(boundsInvalid) warning='Histogram bounds must be finite and the minimum must not exceed the maximum; the result is empty.';
      const compiled=compileHistogramTransformStep({stage,previous,params:p,ordinal,boundsInvalid:!!warning});
      ctes.push(`${q(stage)} AS (${compiled.sql})`);
      columns=compiled.columns;types=compiled.types;ordered=true;orderNeedsCheck=false;
    } else if(step.op==='ratio') {
      const operandSql=operand=>{
        if(operand.kind==='field') return `CASE WHEN ${numericValid(operand.field)} THEN CAST(${q(operand.field)} AS DOUBLE) END`;
        const column=operand.column&&q(operand.column),valid=column?numericValid(operand.column):null,raw=operand.operation==='COUNT'?'COUNT(*)':operand.operation==='COUNT DISTINCT'?`COUNT(DISTINCT ${column})`: `${operand.operation}(CASE WHEN ${valid} THEN CAST(${column} AS DOUBLE) END)`;
        const window=`${raw} OVER (${p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')}`:''})`;
        return operand.operation==='SUM'?`COALESCE(${window},0)`:window;
      };
      const numerator=operandSql(p.numerator),denominator=operandSql(p.denominator),scale=p.percent?' * 100':'',ratio=`CASE WHEN (${numerator}) IS NOT NULL AND isfinite(${numerator}) AND (${denominator}) IS NOT NULL AND isfinite(${denominator}) AND (${denominator}) <> 0 THEN ((${numerator}) / (${denominator}))${scale} ELSE NULL::DOUBLE END`;
      ctes.push(`${q(stage)} AS (SELECT ${columns.map(q).join(', ')}, ${ratio} AS ${q(p.outputName)}, ${q(ordinal)} FROM ${q(previous)})`);
      columns=[...columns,p.outputName];types={...types,[p.outputName]:'Float64'};
      const operandValue=operand=>{
        if(operand.kind==='field') return q(operand.field);
        const column=operand.column&&q(operand.column),valid=column?numericValid(operand.column):null;
        if(operand.operation==='COUNT')return `COUNT(*) OVER (${p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')}`:''})`;
        if(operand.operation==='COUNT DISTINCT')return `COUNT(DISTINCT ${column}) OVER (${p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')}`:''})`;
        const value=`${operand.operation}(CASE WHEN ${valid} THEN CAST(${column} AS DOUBLE) END) OVER (${p.partitions.length?`PARTITION BY ${p.partitions.map(q).join(', ')}`:''})`;
        return operand.operation==='SUM'?`COALESCE(${value},0)`:value;
      };
      const numeratorValue=operandValue(p.numerator),denominatorValue=operandValue(p.denominator);
      const ratioValues=`(SELECT ${numeratorValue} AS ${q('__ratio_numerator')}, ${denominatorValue} AS ${q('__ratio_denominator')} FROM ${q(previous)}) AS ratio_values`;
      ratioDiagnosticSql=[
        `(SELECT COUNT(*) FROM ${ratioValues} WHERE ${q('__ratio_denominator')} = 0) AS ${q('excluded:ratio:denominatorZero')}`,
        `(SELECT COUNT(*) FROM ${ratioValues} WHERE ${q('__ratio_denominator')} IS NULL OR NOT isfinite(${q('__ratio_denominator')})) AS ${q('excluded:ratio:denominatorInvalid')}`,
        `(SELECT COUNT(*) FROM ${ratioValues} WHERE ${q('__ratio_numerator')} IS NULL OR NOT isfinite(${q('__ratio_numerator')})) AS ${q('excluded:ratio:numeratorInvalid')}`
      ];
      const aggregateProvenanceFields=new Set();
      for(const operand of [p.numerator,p.denominator]) if(operand.kind==='aggregate'&&operand.operation!=='COUNT'&&operand.column&&!aggregateProvenanceFields.has(operand.column)) {
        aggregateProvenanceFields.add(operand.column);
        const invalid=operand.operation==='COUNT DISTINCT'?`${q(operand.column)} IS NULL`:`NOT (${numericValid(operand.column)})`;
        ratioDiagnosticSql.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE ${invalid}) AS ${q('excluded:aggregate:'+operand.column)}`);
      }
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
    if(step.op==='cumulative') exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE ${cumulativeInvalidSql}) AS ${q('excluded:invalidValues')}`);
    if(step.op==='change') {
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE ${numericValid(p.previousField)} AND ${q(p.previousField)} = 0) AS ${q('excluded:change:previousZero')}`);
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE NOT (${numericValid(p.previousField)})) AS ${q('excluded:change:previousInvalid')}`);
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE NOT (${numericValid(p.currentField)})) AS ${q('excluded:change:currentInvalid')}`);
    }
    if(step.op==='periodPair') {
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE ${dateValid(p.dateField)} = FALSE) AS ${q('excluded:invalidDates')}`);
      if(p.aggregate!=='COUNT') exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE (${periodCurrentPredicate} OR ${periodPreviousPredicate}) AND NOT (${numericValid(p.measureField)})) AS ${q('excluded:aggregate:'+p.measureField)}`);
    }
    if(step.op==='pivot'&&p.measureField) {
      const invalid=p.aggregate==='COUNT DISTINCT'?`${q(p.measureField)} IS NULL`:`NOT (${numericValid(p.measureField)})`;
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE ${invalid}) AS ${q('excluded:aggregate:'+p.measureField)}`);
    }
    if(step.op==='bucket') exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE TRY_CAST(${q(p.dateField)} AS TIMESTAMP) IS NULL) AS ${q('excluded:invalidDates')}`);
    if(['between','top','movingAvg','stats','histogram'].includes(step.op)) {
      const valid=step.op==='between'&&p.mode==='date'?dateValid(p.field):numericValid(p.field);
      exclusions.push(`(SELECT COUNT(*) FROM ${q(previous)} WHERE NOT (${valid})) AS ${q('excluded:invalidValues')}`);
    }
    if(step.op==='ratio') exclusions.push(...ratioDiagnosticSql);
    const diagnosticsSql=withSql(ctes,`SELECT (SELECT COUNT(*) FROM ${q(previous)}) AS rowsIn, (SELECT COUNT(*) FROM ${q(stage)}) AS rowsOut${exclusions.length?', '+exclusions.join(', '):''}`);
    if(step.op==='groupBy') {columns=names;types=Object.fromEntries([...p.groups.map(field=>[field,'Utf8']),...measures.map(agg=>[agg.name,agg.type])]);ordered=true;orderNeedsCheck=false;}
    else if(step.op==='bucket') {columns=names;types=Object.fromEntries([...p.partitions.map(field=>[field,'Utf8']),[p.periodName,'Utf8'],...measures.map(agg=>[agg.name,agg.type])]);ordered=true;orderNeedsCheck=false;}
    else if(step.op==='movingAvg') types={...types,[p.field]:'Float64'};
    else if(step.op==='stats') {columns=statColumns;types={count:'Int64',min:'Float64',max:'Float64',mean:'Float64',median:'Float64',stddev:'Float64'};ordered=true;orderNeedsCheck=false;}
    else if(step.op==='top') {ordered=true;orderNeedsCheck=false;}
    steps.push({...step,disabled:false,reason:null,warning,inputSql,sql:withSql(ctes,output(stage)),diagnosticsSql,inputColumns,columns:[...columns],types:{...types},...(pivotCategorySql?{pivotCategorySql}:{}),...(pivotOutputMetadata?{outputMetadata:pivotOutputMetadata}:{})});
    previous=stage;
  }
  const errors=steps.filter(step=>step.disabled).map(step=>`${step.id}: ${step.reason}`);
  for(const column of Object.values(chain.outputMapping)) if(!columns.includes(column)&&!dynamicOutput) errors.push(`Output mapping column ${column} is unavailable.`);
  const sql=errors.length?null:withSql(ctes,output(previous));
  if(sql?.length>100000) fail('Compiled transform SQL exceeds the 100,000 character query limit.');
  return {chain,sql,columns,types,steps,guards,errors,parameterDependencies};
}
