import { compileTransformChain } from '../data/wranglingTransforms.js';
import { aggregationOptions, wranglingConfigToken } from '../data/wrangling.js';
import { datasetVersion, subscribeDatasetChanges } from '../data/store.js';
import { validateParameters } from '../data/parameters.js';
import { saveQuery } from '../data/queries.js';
import { guessMapping } from '../tiles/normalize.js';

const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const stepId=()=>`step-${crypto.randomUUID()}`;

/** The Transform tab owns only an editable chain and its preview. Execution,
 * validation and persistence stay at their shared data-layer boundaries. */
export function createTransformEditor({panel,entry,source,chain:initial,getParameters,onQuery,onClose,module}) {
  let chain=structuredClone(initial||{version:1,source,steps:[],outputMapping:entry.dynamicFields?{}:guessMapping(entry,source.schema.columns)});
  let result=null,previewToken=null,busy=false,message='Preview is out of date; run again.';
  const token=()=>wranglingConfigToken('transform',{chain,parameters:getParameters(),revision:datasetVersion()});
  const pivotOptions=()=>result?.pivotCategories?{pivotCategories:result.pivotCategories}:{};
  function analyse() {
    try{return compileTransformChain(chain,{parameters:getParameters(),...pivotOptions()});}
    catch(error){
      let first=0;
      for(const [index] of chain.steps.entries()) {
        try{compileTransformChain({...chain,steps:chain.steps.slice(0,index+1),outputMapping:{}},{parameters:getParameters()});first=index+1;}
        catch{break;}
      }
      return {sql:null,columns:chain.source.schema.columns,types:chain.source.schema.types,errors:[error.message],steps:chain.steps.map((step,index)=>({...step,inputColumns:chain.source.schema.columns,disabled:index>=first,reason:index===first?error.message:index>first?'A preceding step is disabled.':null}))};
    }
  }
  function complete(plan) {return entry.fields.every(field=>field.optional||chain.outputMapping[field.key]&&plan.columns.includes(chain.outputMapping[field.key]));}
  function invalidate() {
    result=null;previewToken=null;message='Preview is out of date; run again.';
    panel.querySelectorAll('.transform-preview,.transform-count,.transform-provenance,.data-apply').forEach(node=>node.remove());
    const status=panel.querySelector('.transform-status');if(status)status.textContent=message;
  }
  function mutate(change,rebuild=true) {change();invalidate();if(rebuild)render();}
  function button(text,label,action,disabled=false) {
    const node=element('button',text);node.type='button';if(label)node.setAttribute('aria-label',label);node.disabled=disabled;node.addEventListener('click',action);return node;
  }
  function select(label,values,value,onChange,{multiple=false,empty=false}={}) {
    const wrap=element('label',label,'transform-control'),node=element('select');node.setAttribute('aria-label',label);node.multiple=multiple;
    if(multiple)node.size=Math.min(4,Math.max(2,values.length));
    if(empty){const option=element('option','— none / count rows —');option.value='';node.append(option);}
    for(const item of values){const [key,text]=Array.isArray(item)?item:[item,item];const option=element('option',text);option.value=key;option.selected=multiple?value.includes(key):key===value;node.append(option);}
    if(!multiple)node.value=value??'';
    node.addEventListener('change',()=>onChange(multiple?[...node.selectedOptions].map(option=>option.value):node.value));wrap.append(node);return wrap;
  }
  function input(label,value,onChange,{type='text',step,min,max}={}) {
    const wrap=element('label',label,'transform-control'),node=element('input');node.type=type;node.value=value??'';node.maxLength=200;if(step!==undefined)node.step=String(step);if(min!==undefined)node.min=String(min);if(max!==undefined)node.max=String(max);node.setAttribute('aria-label',label);node.addEventListener('input',()=>onChange(type==='number'?(node.value===''?null:Number(node.value)):node.value));wrap.append(node);return wrap;
  }
  function defaults(op,columns,types) {
    const value=columns.find(column=>aggregationOptions(types[column]).includes('SUM'))||null;
    const date=columns.find(column=>/date|time/i.test(column)||/Date|Timestamp/i.test(types[column]))||columns[0];
    if(op==='groupBy') {
      const group=columns.find(column=>!aggregationOptions(types[column]).includes('SUM'));
      return {groups:group?[group]:[],aggregations:[{column:value,operation:value?'SUM':'COUNT',name:group==='value'?'total':'value'}]};
    }
    if(op==='bucket')return {dateField:date,grain:'day',partitions:[],aggregations:[{column:value,operation:value?'SUM':'COUNT',name:'value'}],periodName:'period'};
    if(op==='between')return {field:value||columns[0],mode:'numeric',lower:0,upper:100};
    if(op==='top')return {field:value||columns[0],n:5,direction:'desc'};
    if(op==='movingAvg')return {field:value||columns[0],window:7,partitions:[]};
    if(op==='cumulative')return {field:value||columns[0],partitions:[]};
    if(op==='change')return {currentField:value||columns[0],previousField:value||columns[0],outputName:'change_pct'};
    if(op==='periodPair')return {dateField:date,categoryField:null,measureField:value||columns[0],aggregate:value?'SUM':'COUNT',currentWindow:{kind:'relative',days:30},previousWindow:null,outputCurrent:'current',outputPrevious:'previous'};
    if(op==='pivot') {const categories=columns.filter(column=>!aggregationOptions(types[column]).includes('SUM'));return {rowFields:categories.slice(0,1),columnField:categories[1]||columns[0],measureField:value,aggregate:value?'SUM':'COUNT'};}
    if(op==='histogram')return {field:value||columns[0],bins:20,min:null,max:null};
    if(op==='ratio')return {numerator:{kind:'field',field:value||columns[0]},denominator:{kind:'field',field:columns.find(column=>column!==value&&aggregationOptions(types[column]).includes('SUM'))||value||columns[0]},partitions:[],percent:false,outputName:'ratio'};
    return {field:value||columns[0]};
  }
  function numericParameterNames(){return validateParameters(getParameters()).filter(parameter=>parameter.type==='number').map(parameter=>parameter.name);}
  function textParameterNames(){return validateParameters(getParameters()).filter(parameter=>parameter.type==='text').map(parameter=>parameter.name);}
  function renderNumericValue(box,index,label,value,onChange) {
    const ref=typeof value==='object'&&value!==null;
    box.append(select(`Step ${index+1} ${label} kind`,[['literal','Literal'],['parameter','Existing parameter']],ref?'parameter':'literal',kind=>mutate(()=>{onChange(kind==='parameter'?{param:numericParameterNames()[0]||''}:1);} )));
    if(ref)box.append(select(`Step ${index+1} ${label} parameter`,numericParameterNames(),value.param,next=>mutate(()=>{onChange({param:next});})));
    else box.append(input(`Step ${index+1} ${label}`,value,next=>mutate(()=>{onChange(next);},false),{type:'number',step:1,min:1}));
  }
  function renderBound(box,index,label,value,mode,onChange) {
    const ref=typeof value==='object'&&value!==null,available=mode==='numeric'?numericParameterNames():textParameterNames();
    box.append(select(`Step ${index+1} ${label} kind`,[['literal','Literal'],['parameter','Existing parameter']],ref?'parameter':'literal',kind=>mutate(()=>{onChange(kind==='parameter'?{param:available[0]||''}:mode==='numeric'?0:'2026-01-01');})));
    if(ref)box.append(select(`Step ${index+1} ${label} parameter`,available,value.param,next=>mutate(()=>{onChange({param:next});})));
    else box.append(input(`Step ${index+1} ${label}`,value,next=>mutate(()=>{onChange(next);},false),mode==='numeric'?{type:'number',step:'any'}:{}));
  }
  function renderPeriodWindow(box,index,label,window,onChange) {
    box.append(select(`Step ${index+1} ${label} window kind`,[['relative','Relative days'],['range','Date range']],window.kind,kind=>mutate(()=>{onChange(kind==='relative'?{kind,days:30}:{kind,start:'2026-01-01',end:'2026-01-31'});} )));
    if(window.kind==='relative')renderNumericValue(box,index,`${label} window days`,window.days,value=>{window.days=value;});
    else {
      renderBound(box,index,`${label} start date`,window.start,'date',value=>{window.start=value;});
      renderBound(box,index,`${label} end date`,window.end,'date',value=>{window.end=value;});
    }
  }
  function renderRatioOperand(box,index,label,operand,columns,types,onChange) {
    const numericColumns=columns.filter(column=>aggregationOptions(types[column]).includes('SUM'));
    box.append(select(`Step ${index+1} ${label} kind`,[['field','Field'],['aggregate','Aggregate']],operand.kind,kind=>mutate(()=>onChange(kind==='field'?{kind,field:numericColumns[0]||columns[0]}:{kind,operation:'SUM',column:numericColumns[0]||null}))));
    if(operand.kind==='field') box.append(select(`Step ${index+1} ${label} field`,numericColumns,operand.field,value=>mutate(()=>onChange({kind:'field',field:value}))));
    else {
      box.append(select(`Step ${index+1} ${label} aggregate`,['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'],operand.operation,value=>mutate(()=>onChange({kind:'aggregate',operation:value,column:value==='COUNT'?null:operand.column||(numericColumns[0]||columns[0]||null)}))));
      if(operand.operation!=='COUNT')box.append(select(`Step ${index+1} ${label} aggregate field`,columns,operand.column||'',value=>mutate(()=>onChange({...operand,column:value||null})),{empty:true}));
    }
  }
  function renderAggregates(box,step,index,columns) {
    for(const [aggIndex,aggregate] of step.params.aggregations.entries()) {
      const label=`Step ${index+1} aggregation ${aggIndex+1}`,row=element('div',undefined,'transform-aggregate');
      row.append(select(label+' source column',columns,aggregate.column||'',value=>mutate(()=>{const old=aggregate.column;aggregate.column=value||null;if(!value)aggregate.operation='COUNT';else if(!old)aggregate.operation='SUM';}),{empty:true}));
      row.append(select(label+' operation',['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'],aggregate.operation,value=>mutate(()=>{aggregate.operation=value;})));
      row.append(input(label+' output name',aggregate.name,value=>mutate(()=>{aggregate.name=value;},false)));
      row.append(button('Remove aggregation',`Remove aggregation ${aggIndex+1} from step ${index+1}`,()=>mutate(()=>{step.params.aggregations.splice(aggIndex,1);}),step.params.aggregations.length===1));box.append(row);
    }
    box.append(button('Add aggregation',`Add aggregation to step ${index+1}`,()=>mutate(()=>{
      const value=columns.find(column=>aggregationOptions(analyse().types?.[column]).includes('SUM'))||null;
      step.params.aggregations.push({column:value,operation:value?'SUM':'COUNT',name:`value${step.params.aggregations.length+1}`});
    }),step.params.aggregations.length>=20));
  }
  function render() {
    panel.replaceChildren();const plan=analyse();
    panel.append(element('p','Transforms run in order before chart mapping. Numeric text is excluded from numeric aggregates; source rows stay unchanged.','data-sql-note'));
    const order=chain.source.order;
    panel.append(select('Source order',[['none','No declared order'],...(chain.source.table?[['sourceOrdinal','Original source row order']]:[]),['columns','Choose order fields']],order?.kind||'none',kind=>mutate(()=>{chain.source.order=kind==='none'?null:kind==='sourceOrdinal'?{kind}:{kind,fields:[chain.source.schema.columns[0]]};})));
    if(order?.kind==='columns')panel.append(select('Source order fields',chain.source.schema.columns,order.fields,fields=>mutate(()=>{order.fields=fields;}),{multiple:true}));
    for(const [index,step] of chain.steps.entries()) {
      const metadata=plan.steps[index],columns=metadata?.inputColumns||chain.source.schema.columns;
      const box=element('fieldset',undefined,'transform-step');box.append(element('legend',`Step ${index+1}`));
      box.append(select(`Step ${index+1} operation`,[['groupBy','Group & summarize'],['bucket','Bucket dates'],['between','Between'],['top','Top'],['movingAvg','Moving average'],['stats','Stats'],['cumulative','Cumulative'],['change','Change'],['periodPair','Paired periods'],['pivot','Pivot'],['histogram','Histogram'],['ratio','Ratio (convenience extension)']],step.op,op=>mutate(()=>{step.op=op;step.params=defaults(op,columns,index?plan.steps[index-1]?.types||plan.types:chain.source.schema.types);} )));
      const actions=element('div',undefined,'transform-step-actions');
      for(const [down,label] of [[false,'up'],[true,'down']])actions.append(button(down?'Move down':'Move up',`Move step ${index+1} ${label}`,()=>mutate(()=>{const next=index+(down?1:-1);[chain.steps[index],chain.steps[next]]=[chain.steps[next],chain.steps[index]];}),down?index===chain.steps.length-1:index===0));
      actions.append(button('Remove step',`Remove step ${index+1}`,()=>mutate(()=>{chain.steps.splice(index,1);})));box.append(actions);
      if(step.op==='groupBy')box.append(select(`Step ${index+1} grouping columns`,columns,step.params.groups,fields=>mutate(()=>{step.params.groups=fields;}),{multiple:true}));
      else if(step.op==='bucket') {
        box.append(select(`Step ${index+1} date column`,columns,step.params.dateField,value=>mutate(()=>{step.params.dateField=value;})));
        const ref=typeof step.params.grain==='object';
        box.append(select(`Step ${index+1} grain`,[['day','Day'],['week','Week (Monday start)'],['month','Month'],['parameter','Existing parameter']],ref?'parameter':step.params.grain,value=>mutate(()=>{step.params.grain=value==='parameter'?{param:validateParameters(getParameters()).find(parameter=>parameter.type==='text')?.name||''}:value;})));
        if(ref)box.append(select(`Step ${index+1} grain parameter`,validateParameters(getParameters()).filter(parameter=>parameter.type==='text').map(parameter=>parameter.name),step.params.grain.param,value=>mutate(()=>{step.params.grain={param:value};})));
        box.append(select(`Step ${index+1} partition columns`,columns,step.params.partitions,fields=>mutate(()=>{step.params.partitions=fields;}),{multiple:true}));
        box.append(input(`Step ${index+1} period output name`,step.params.periodName,value=>mutate(()=>{step.params.periodName=value;},false)));
      } else if(step.op==='between') {
        box.append(select(`Step ${index+1} column`,columns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
        box.append(select(`Step ${index+1} mode`,[['numeric','Numeric'],['date','Date']],step.params.mode,value=>mutate(()=>{step.params.mode=value;step.params.lower=value==='numeric'?0:'2026-01-01';step.params.upper=value==='numeric'?100:'2026-12-31';})));
        renderBound(box,index,'lower bound',step.params.lower,step.params.mode,value=>{step.params.lower=value;});
        renderBound(box,index,'upper bound',step.params.upper,step.params.mode,value=>{step.params.upper=value;});
      } else if(step.op==='top') {
        box.append(select(`Step ${index+1} column`,columns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
        renderNumericValue(box,index,'N',step.params.n,value=>{step.params.n=value;});
        box.append(select(`Step ${index+1} direction`,[['desc','Descending'],['asc','Ascending']],step.params.direction,value=>mutate(()=>{step.params.direction=value;})));
      } else if(step.op==='movingAvg') {
        box.append(select(`Step ${index+1} column`,columns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
        renderNumericValue(box,index,'window',step.params.window,value=>{step.params.window=value;});
        box.append(select(`Step ${index+1} partition columns`,columns,step.params.partitions,fields=>mutate(()=>{step.params.partitions=fields;}),{multiple:true}));
      } else if(step.op==='stats')box.append(select(`Step ${index+1} column`,columns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
      else if(step.op==='cumulative') {
        box.append(select(`Step ${index+1} column`,columns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
        box.append(select(`Step ${index+1} partition columns`,columns,step.params.partitions,fields=>mutate(()=>{step.params.partitions=fields;}),{multiple:true}));
      } else if(step.op==='change') {
        const numericColumns=columns.filter(column=>aggregationOptions(metadata?.types?.[column]||plan.types?.[column]).includes('SUM'));
        box.append(select(`Step ${index+1} current column`,numericColumns,step.params.currentField,value=>mutate(()=>{step.params.currentField=value;})));
        box.append(select(`Step ${index+1} previous column`,numericColumns,step.params.previousField,value=>mutate(()=>{step.params.previousField=value;})));
        box.append(input(`Step ${index+1} output name`,step.params.outputName,value=>mutate(()=>{step.params.outputName=value;},false)));
      } else if(step.op==='periodPair') {
        box.append(select(`Step ${index+1} date column`,columns,step.params.dateField,value=>mutate(()=>{step.params.dateField=value;})));
        box.append(select(`Step ${index+1} category column`,columns,step.params.categoryField||'',value=>mutate(()=>{step.params.categoryField=value||null;}),{empty:true}));
        box.append(select(`Step ${index+1} measure column`,columns,step.params.measureField,value=>mutate(()=>{step.params.measureField=value;})));
        box.append(select(`Step ${index+1} aggregate`,[['SUM','Sum'],['COUNT','Count rows'],['AVG','Average']],step.params.aggregate,value=>mutate(()=>{step.params.aggregate=value;})));
        renderPeriodWindow(box,index,'current',step.params.currentWindow,value=>{step.params.currentWindow=value;});
        box.append(select(`Step ${index+1} previous window`,[['default','Immediately preceding equal-length window'],['explicit','Choose previous window']],step.params.previousWindow?'explicit':'default',value=>mutate(()=>{step.params.previousWindow=value==='default'?null:structuredClone(step.params.currentWindow);} )));
        if(step.params.previousWindow)renderPeriodWindow(box,index,'previous',step.params.previousWindow,value=>{step.params.previousWindow=value;});
        box.append(input(`Step ${index+1} current output name`,step.params.outputCurrent,value=>mutate(()=>{step.params.outputCurrent=value;},false)));
        box.append(input(`Step ${index+1} previous output name`,step.params.outputPrevious,value=>mutate(()=>{step.params.outputPrevious=value;},false)));
      } else if(step.op==='pivot') {
        box.append(select(`Step ${index+1} row key fields`,columns,step.params.rowFields,fields=>mutate(()=>{step.params.rowFields=fields;}),{multiple:true}));
        box.append(select(`Step ${index+1} column key field`,columns,step.params.columnField,value=>mutate(()=>{step.params.columnField=value;})));
        box.append(select(`Step ${index+1} measure field`,columns,step.params.measureField||'',value=>mutate(()=>{step.params.measureField=value||null;}),{empty:true}));
        box.append(select(`Step ${index+1} aggregate`,['SUM','AVG','COUNT','MIN','MAX','COUNT DISTINCT'],step.params.aggregate,value=>mutate(()=>{step.params.aggregate=value;if(value==='COUNT')step.params.measureField=null;})));
      } else if(step.op==='histogram') {
        const numericColumns=columns.filter(column=>aggregationOptions(plan.types?.[column]||chain.source.schema.types[column]).includes('SUM'));
        box.append(select(`Step ${index+1} column`,numericColumns,step.params.field,value=>mutate(()=>{step.params.field=value;})));
        box.append(input(`Step ${index+1} bins`,step.params.bins,value=>mutate(()=>{step.params.bins=value;}),{type:'number',step:1,min:1,max:500}));
        box.append(input(`Step ${index+1} minimum`,step.params.min,value=>mutate(()=>{step.params.min=value;},false),{type:'number',step:'any'}));
        box.append(input(`Step ${index+1} maximum`,step.params.max,value=>mutate(()=>{step.params.max=value;},false),{type:'number',step:'any'}));
      } else if(step.op==='ratio') {
        renderRatioOperand(box,index,'numerator',step.params.numerator,columns,metadata?.types||plan.types,value=>{step.params.numerator=value;});
        renderRatioOperand(box,index,'denominator',step.params.denominator,columns,metadata?.types||plan.types,value=>{step.params.denominator=value;});
        box.append(select(`Step ${index+1} partition fields`,columns,step.params.partitions,fields=>mutate(()=>{step.params.partitions=fields;}),{multiple:true}));
        box.append(select(`Step ${index+1} percent scale`,[['false','Ratio'],['true','Percent']],String(step.params.percent),value=>mutate(()=>{step.params.percent=value==='true';})));
        box.append(input(`Step ${index+1} output name`,step.params.outputName,value=>mutate(()=>{step.params.outputName=value;},false)));
      }
      if(step.op==='groupBy'||step.op==='bucket')renderAggregates(box,step,index,columns);
      const actual=result?.steps.find(item=>item.id===step.id);
      const reason=actual?.reason||metadata?.reason;
      if(reason){const error=element('p','Disabled: '+reason,'transform-error data-error');error.setAttribute('role','alert');box.append(error);}
      const warning=actual?.warning||metadata?.warning;
      if(warning){const node=element('p','Warning: '+warning,'transform-warning data-warning');node.setAttribute('role','alert');box.append(node);}
      if(actual?.rowsIn!=null)box.append(element('p',`${actual.rowsIn.toLocaleString()} rows → ${actual.rowsOut.toLocaleString()} rows`,'transform-count'));
      for(const count of actual?.provenance||[])if(!count.kind.startsWith('ratio:'))box.append(element('p',count.kind==='invalidDates'?`${count.count.toLocaleString()} ${step.op==='periodPair'?'bad dates excluded from period windows':'bad dates dropped'}`:count.kind==='cumulativeInvalids'?`${count.count.toLocaleString()} invalid/missing contributions treated as 0 in ${count.name}`:count.kind.startsWith('change:')?`${count.count.toLocaleString()} ${count.kind.slice(7)} Change values render as null`:count.kind==='invalidSamples'?`${count.count.toLocaleString()} invalid/missing samples ignored in ${count.name}`:`${count.count.toLocaleString()} invalid/missing values excluded from ${count.name}`,'transform-provenance'));
      if(actual?.provenance)for(const count of actual.provenance.filter(item=>item.kind.startsWith('ratio:')))box.append(element('p',`${count.count.toLocaleString()} ${count.kind==='ratio:denominatorZero'?'zero denominators':count.kind==='ratio:denominatorInvalid'?'missing/invalid denominators':'missing/invalid numerators'} produce null ratios`,'transform-provenance'));
      if(actual?.outputMetadata?.categories) {
        const details=element('details',undefined,'transform-pivot-metadata'),summary=element('summary','Pivot output column metadata');details.append(summary);
        for(const category of actual.outputMetadata.categories)details.append(element('p',`${category.label==null?'(null)':String(category.label)} → ${category.column}`));
        box.append(details);
      }
      panel.append(box);
    }
    const add=element('div',undefined,'transform-add');
    const operation=element('select');operation.setAttribute('aria-label','New transform operation');for(const [value,label] of [['groupBy','Group & summarize'],['bucket','Bucket dates'],['between','Between'],['top','Top'],['movingAvg','Moving average'],['stats','Stats'],['cumulative','Cumulative'],['change','Change'],['periodPair','Paired periods'],['pivot','Pivot'],['histogram','Histogram'],['ratio','Ratio (convenience extension)']]){const option=element('option',label);option.value=value;operation.append(option);}
    add.append(operation,button('Add step',null,()=>mutate(()=>{chain.steps.push({id:stepId(),op:operation.value,params:defaults(operation.value,plan.columns,plan.types)});}),chain.steps.length>=30));panel.append(add);
    if(!entry.dynamicFields) {
      const mapping=element('div',undefined,'data-mapping');mapping.append(element('strong','Chart output mapping'));
      for(const field of entry.fields)mapping.append(select(`Output ${field.label}`,plan.columns,chain.outputMapping[field.key]||'',value=>mutate(()=>{if(value)chain.outputMapping[field.key]=value;else delete chain.outputMapping[field.key];},false),{empty:true}));
      panel.append(mapping);
    }
    const status=element('p',busy?'Running transforms…':message,'transform-status data-sql-note');status.setAttribute('role','status');panel.append(status);
    for(const error of result?.errors||[]) {const node=element('p',error,'transform-error data-error');node.setAttribute('role','alert');panel.append(node);}
    if(plan.errors.length&&!chain.steps.some((step,index)=>plan.steps[index]?.reason))for(const error of plan.errors){const node=element('p',error,'transform-error data-error');node.setAttribute('role','alert');panel.append(node);}
    panel.append(button('Preview transforms',null,preview,busy));
    if(result&&!result.errors.length&&previewToken) {
      const sample=element('div',undefined,'transform-preview');
      sample.append(element('p',`${result.rows.length} sample rows · ${result.steps.at(-1)?.rowsOut??result.rows.length} output rows`,'data-preview-note'));
      const table=element('table',undefined,'data-preview'),head=element('thead'),titles=element('tr');for(const column of result.columns)titles.append(element('th',column));head.append(titles);table.append(head);
      const body=element('tbody');for(const row of result.rows.slice(0,5)){const tr=element('tr');for(const column of result.columns)tr.append(element('td',row[column]==null?'—':String(row[column])));body.append(tr);}table.append(body);sample.append(table);panel.append(sample);
      const apply=button('Apply derived query to tile',null,()=>{
        if(busy||previewToken!==token()||!complete(analyse())){invalidate();render();return;}
        const saved=saveQuery({chain,sql:result.sql,columns:result.columns,fieldKeys:entry.dynamicFields?[...result.columns]:entry.fields.map(field=>field.key),mapping:{...chain.outputMapping},dependencies:chain.source.dependencies});
        onQuery?.(saved);onClose();
      },!complete(plan));apply.className='data-apply';panel.append(apply);
    }
  }
  async function preview() {
    if(busy)return;invalidate();const captured=token(),snapshot=structuredClone(chain),parameters=structuredClone(getParameters());busy=true;render();
    try {
      const completed=await module.previewTransformChain(snapshot,parameters);
      if(captured!==token())return;
      chain=completed.chain;result=completed;previewToken=completed.errors.length?null:token();message=completed.errors.length?'Fix the disabled steps before applying.':'Preview is current; source unchanged.';
    } catch(error){if(captured===token())message=error.message;}
    finally{busy=false;render();}
  }
  const unsubscribe=subscribeDatasetChanges(()=>{invalidate();render();});
  render();
  return {invalidate:()=>{invalidate();render();},replaceSource(next){chain={version:1,source:structuredClone(next),steps:[],outputMapping:{}};invalidate();render();},dispose:unsubscribe};
}
