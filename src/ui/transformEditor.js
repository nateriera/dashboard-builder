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
  function analyse() {
    try{return compileTransformChain(chain,{parameters:getParameters()});}
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
  function input(label,value,onChange) {
    const wrap=element('label',label,'transform-control'),node=element('input');node.type='text';node.value=value;node.maxLength=200;node.setAttribute('aria-label',label);node.addEventListener('input',()=>onChange(node.value));wrap.append(node);return wrap;
  }
  function defaults(op,columns,types) {
    const value=columns.find(column=>aggregationOptions(types[column]).includes('SUM'))||null;
    if(op==='groupBy') {
      const group=columns.find(column=>!aggregationOptions(types[column]).includes('SUM'));
      return {groups:group?[group]:[],aggregations:[{column:value,operation:value?'SUM':'COUNT',name:group==='value'?'total':'value'}]};
    }
    return {dateField:columns.find(column=>/date|time/i.test(column)||/Date|Timestamp/i.test(types[column]))||columns[0],grain:'day',partitions:[],aggregations:[{column:value,operation:value?'SUM':'COUNT',name:'value'}],periodName:'period'};
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
      box.append(select(`Step ${index+1} operation`,[['groupBy','Group & summarize'],['bucket','Bucket dates']],step.op,op=>mutate(()=>{step.op=op;step.params=defaults(op,columns,index?plan.steps[index-1]?.types||plan.types:chain.source.schema.types);})));
      const actions=element('div',undefined,'transform-step-actions');
      for(const [down,label] of [[false,'up'],[true,'down']])actions.append(button(down?'Move down':'Move up',`Move step ${index+1} ${label}`,()=>mutate(()=>{const next=index+(down?1:-1);[chain.steps[index],chain.steps[next]]=[chain.steps[next],chain.steps[index]];}),down?index===chain.steps.length-1:index===0));
      actions.append(button('Remove step',`Remove step ${index+1}`,()=>mutate(()=>{chain.steps.splice(index,1);})));box.append(actions);
      if(step.op==='groupBy')box.append(select(`Step ${index+1} grouping columns`,columns,step.params.groups,fields=>mutate(()=>{step.params.groups=fields;}),{multiple:true}));
      else {
        box.append(select(`Step ${index+1} date column`,columns,step.params.dateField,value=>mutate(()=>{step.params.dateField=value;})));
        const ref=typeof step.params.grain==='object';
        box.append(select(`Step ${index+1} grain`,[['day','Day'],['week','Week (Monday start)'],['month','Month'],['parameter','Existing parameter']],ref?'parameter':step.params.grain,value=>mutate(()=>{step.params.grain=value==='parameter'?{param:validateParameters(getParameters()).find(parameter=>parameter.type==='text')?.name||''}:value;})));
        if(ref)box.append(select(`Step ${index+1} grain parameter`,validateParameters(getParameters()).filter(parameter=>parameter.type==='text').map(parameter=>parameter.name),step.params.grain.param,value=>mutate(()=>{step.params.grain={param:value};})));
        box.append(select(`Step ${index+1} partition columns`,columns,step.params.partitions,fields=>mutate(()=>{step.params.partitions=fields;}),{multiple:true}));
        box.append(input(`Step ${index+1} period output name`,step.params.periodName,value=>mutate(()=>{step.params.periodName=value;},false)));
      }
      renderAggregates(box,step,index,columns);
      const actual=result?.steps.find(item=>item.id===step.id);
      const reason=actual?.reason||metadata?.reason;
      if(reason){const error=element('p','Disabled: '+reason,'transform-error data-error');error.setAttribute('role','alert');box.append(error);}
      if(actual?.rowsIn!=null)box.append(element('p',`${actual.rowsIn.toLocaleString()} rows → ${actual.rowsOut.toLocaleString()} rows`,'transform-count'));
      for(const count of actual?.provenance||[])box.append(element('p',count.kind==='invalidDates'?`${count.count.toLocaleString()} bad dates dropped`:`${count.count.toLocaleString()} invalid/missing values excluded from ${count.name}`,'transform-provenance'));
      panel.append(box);
    }
    const add=element('div',undefined,'transform-add');
    const operation=element('select');operation.setAttribute('aria-label','New transform operation');for(const [value,label] of [['groupBy','Group & summarize'],['bucket','Bucket dates']]){const option=element('option',label);option.value=value;operation.append(option);}
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
