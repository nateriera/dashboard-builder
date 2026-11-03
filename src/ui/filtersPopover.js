import { anchorPopover } from "./anchoredPopover.js";
import { focusDialog } from "./focus.js";
import { dateRangeForPreset, validateFilters } from "../data/filters.js";
import { enumerateParameterOptions, validateParameters } from "../data/parameters.js";
import { DATASETS, DATASET_LABELS } from "../tiles/registry.js";
import { getDataset, listDatasets } from "../data/store.js";
import { parameterConsumers, parameterConsumerKindLabel } from "../data/parameterConsumers.js";
import { bindingCompatibilityError, bindingConflict, bindingFilterValues, parameterFilterBinding, parameterValueFromFilter, validateParameterBindings } from "../data/parameterBindings.js";

let popover = null;
let anchor = null;
let releaseAnchor = null;
let releaseFocus = null;
let outsideHandler = null;
let keyHandler = null;

const element = (tag, className, text) => {
  const node=document.createElement(tag);
  if (className) node.className=className;
  if (text !== undefined) node.textContent=text;
  return node;
};

function newId(prefix) {
  const suffix=globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  return `${prefix}-${suffix}`;
}

export function closeFiltersPopover() {
  if (!popover) return;
  releaseAnchor?.(); releaseAnchor=null;
  releaseFocus?.(); releaseFocus=null;
  document.removeEventListener("pointerdown",outsideHandler);
  document.removeEventListener("keydown",keyHandler);
  popover.remove(); popover=null; anchor=null;
}

export function toggleFiltersPopover(options) {
  if (popover && anchor===options.anchor) { closeFiltersPopover(); return; }
  closeFiltersPopover();
  openFiltersPopover(options);
}

function openFiltersPopover({ anchor: nextAnchor, filters, parameters, defaultDataset, tiles = [], pages = [], queries = [], savedViews = [], tileTitle, onFiltersChange, onParametersChange, onDetachParameterConsumers }) {
  anchor=nextAnchor;
  const filterTiles=tiles;
  let currentFilters=validateFilters(filters);
  let currentParameters=validateParameters(parameters);
  let currentQueries=queries;
  let currentViews=savedViews;
  let activeTab="filters";
  let addFilterOpen=false;
  let editingFilterId=null;
  let addParameterOpen=false;

  const pop=element("div","data-popover dashboard-filters-popover");
  pop.setAttribute("role","dialog");
  pop.setAttribute("aria-label","Dashboard filters and parameters");
  const head=element("div","data-pop-head");
  const title=element("span","","Filters and parameters");
  const close=element("button","data-pop-close","×");
  close.type="button";close.setAttribute("aria-label","Close filters and parameters");
  close.addEventListener("click",closeFiltersPopover);
  head.append(title,close);
  const tabs=element("div","data-tabs");tabs.setAttribute("role","tablist");
  const filtersTab=element("button","data-tab","Filters");filtersTab.type="button";filtersTab.setAttribute("role","tab");filtersTab.setAttribute("aria-controls","dashboard-filters-panel");
  const parametersTab=element("button","data-tab","Parameters");parametersTab.type="button";parametersTab.setAttribute("role","tab");parametersTab.setAttribute("aria-controls","dashboard-parameters-panel");
  tabs.append(filtersTab,parametersTab);
  const panel=element("div","data-panel dashboard-filters-panel");panel.id="dashboard-filters-panel";panel.setAttribute("role","tabpanel");
  pop.append(head,tabs,panel);
  document.body.append(pop);
  popover=pop;
  releaseAnchor=anchorPopover(pop,anchor,{preferBelow:true,minTop:Math.max(0,(document.querySelector('#app-header')?.getBoundingClientRect().bottom||0)+6)});
  releaseFocus=focusDialog(pop,anchor);

  const emitFilters=next=>{
    const previous=currentFilters;
    const normalized=validateFilters(next);
    validateParameterBindings(currentParameters,normalized,filterFieldInfos);
    currentFilters=normalized;
    onFiltersChange(currentFilters);
    const updated=currentParameters.map(parameter=>{
      const binding=parameterFilterBinding(parameter);if(!binding)return parameter;
      const before=previous.find(filter=>filter.id===binding.filterId),after=currentFilters.find(filter=>filter.id===binding.filterId);
      if(!before||!after||JSON.stringify(before.values)===JSON.stringify(after.values))return parameter;
      const result=parameterValueFromFilter(parameter,after);
      return result.conflict?parameter:{...parameter,value:result.value};
    });
    if(updated.some((parameter,index)=>JSON.stringify(parameter.value)!==JSON.stringify(currentParameters[index].value))){currentParameters=validateParameters(updated);onParametersChange(currentParameters);}
  };
  const emitParameters=next=>{
    const previous=currentParameters;
    const validated=validateParameters(next);
    validateParameterBindings(validated,currentFilters,filterFieldInfos);
    currentParameters=validated;
    onParametersChange(currentParameters);
    const filtersNext=currentFilters.map(filter=>{
      const parameter=currentParameters.find(item=>parameterFilterBinding(item)?.filterId===filter.id);
      const old=previous.find(item=>item.name===parameter?.name);
      if(!parameter||!old||JSON.stringify(old.value)===JSON.stringify(parameter.value)||parameterFilterBinding(old)?.filterId!==filter.id)return filter;
      const values=bindingFilterValues(parameter);
      return values===null?filter:{...filter,values};
    });
    if(filtersNext.some((filter,index)=>JSON.stringify(filter.values)!==JSON.stringify(currentFilters[index].values))){currentFilters=validateFilters(filtersNext);onFiltersChange(currentFilters);}
  };
  const boundParameter=filterId=>currentParameters.find(parameter=>parameterFilterBinding(parameter)?.filterId===filterId)||null;
  const filterFieldInfos=filter=>{
    const targets=filter.targets||filterTiles.filter(tile=>(!filter.pageId||tile.pageId===filter.pageId)&&tile.fields.some(field=>field.field===filter.field)).map(tile=>({tileId:tile.id,field:filter.field}));
    return targets.map(target=>{const tile=filterTiles.find(item=>item.id===target.tileId);const field=tile?.fields.find(item=>item.field===target.field);return field?{...field,field:target.field,checkable:field.checkable!==false}:null;}).filter(Boolean);
  };
  const filterDescription=filter=>{
    if(filter.op==='between') return `${filter.field} between ${filter.values[0]} and ${filter.values[1]}`;
    if(filter.op==='date-between') {
      const source=filter.source==='crossfilter'?` — from “${tileTitle(filter.sourceTile)}”`:'';
      return filter.relativePreset
        ? `${filter.field} · ${({"last-7-days":"Last 7 days","last-30-days":"Last 30 days","month-to-date":"Month to date","last-month":"Last month","year-to-date":"Year to date"})[filter.relativePreset]}${source}`
        : `${filter.field} from ${filter.values[0]} to ${filter.values[1]}${source}`;
    }
    const values=filter.values.map(value=>value===null?'Blank':String(value));
    const valueText=values.length>2?`${values[0]} + ${values.length-1} more`:values.join(', ');
    const op=filter.op==='is-not'?'is not':'is';
    const source=filter.source==='crossfilter'?` — from “${tileTitle(filter.sourceTile)}”`:'';
    return `${filter.field} ${op} ${valueText}${source}`;
  };

  function renderFiltersPanel() {
    activeTab="filters";
    filtersTab.classList.add("active");parametersTab.classList.remove("active");
    filtersTab.setAttribute("aria-selected","true");parametersTab.setAttribute("aria-selected","false");
    panel.id="dashboard-filters-panel";panel.className="data-panel dashboard-filters-panel";
    panel.replaceChildren();
    const note=element("p","filters-help","Choose which charts a filter controls and map each chart to the matching field. Date ranges use calendar dates.");
    panel.append(note);
    if(!filterTiles.length)panel.append(element('p','filters-help','Add a data-backed chart before creating a dashboard filter.'));
    const list=element("div","dashboard-filter-list");
    for(const filter of currentFilters){
      const chip=element("div",filter.source==='crossfilter'?'dashboard-filter-chip crossfilter-chip':'dashboard-filter-chip');
      if(filter.source==='crossfilter') chip.setAttribute("data-crossfilter-chip","true");
      const scopeName=filter.source==='crossfilter'?'selection':filter.scope==='page'?'page':filter.scope==='charts'||filter.targets?'selected charts':'dashboard';
      const bound=boundParameter(filter.id);
      const conflict=bound?bindingConflict(bound,filter):null;
      const caption=element("span","",`${filterDescription(filter)} · ${scopeName}${bound?` · bound to parameter ${bound.name}`:''}`);
      const remove=element("button","filter-remove","×");remove.type="button";remove.title=`Remove ${filter.field} filter`;remove.setAttribute("aria-label",`Remove ${filter.field} filter`);
      remove.addEventListener("click",()=>{
        if(bound&&!window.confirm(`Filter “${filter.field}” is bound to parameter ${bound.name}. Remove the filter and unbind the parameter?`))return;
        if(bound)emitParameters(currentParameters.map(item=>item.name===bound.name?{...item,bindings:undefined}:item));
        emitFilters(currentFilters.filter(item=>item.id!==filter.id));renderFiltersPanel();
      });
      chip.append(caption,remove);list.append(chip);
      if(conflict){const status=element('p','parameter-binding-conflict',conflict);status.setAttribute('role','alert');chip.append(status);}
      if(filter.source!=='crossfilter'){
        const edit=element('button','filter-edit','Edit');edit.type='button';edit.setAttribute('aria-label',`Edit ${filter.field} filter`);
        edit.addEventListener('click',()=>{editingFilterId=filter.id;addFilterOpen=true;renderFiltersPanel();});chip.append(edit);
      }
      if(filter.source!=='crossfilter'){
        const connectionBox=element("details","filter-connections");
        const summary=element("summary","",filter.targets ? `${filter.targets.length} chart connection${filter.targets.length===1?'':'s'}` : 'Same-name fields across charts');
        connectionBox.append(summary);
        const controls=element("div","filter-connection-list");
        const type=filter.op==='between'?'number':filter.op==='date-between'?'date':'category';
        const existing=filter.targets || filterTiles.flatMap(tile=>tile.fields.some(field=>field.field===filter.field&&field.type===type)?[{tileId:tile.id,field:filter.field}]:[]);
        let pendingTargets=existing;
        let pendingScope=filter.scope||(filter.targets?'charts':'dashboard');
        let pendingPage=filter.pageId||filterTiles.find(tile=>tile.id===existing[0]?.tileId)?.pageId||pages[0]?.id||'';
        const scopeLabel=element('label','filter-field-label','Scope');
        const scopeSelect=element('select','filter-field-select');scopeSelect.setAttribute('aria-label',`Scope for ${filter.field} filter`);
        for(const [value,label] of [['dashboard','Dashboard'],['page','Page'],['charts','Selected charts']]){const option=element('option','',label);option.value=value;scopeSelect.append(option);}
        scopeSelect.value=pendingScope;
        const pageSelect=element('select','filter-field-select');pageSelect.setAttribute('aria-label',`Page for ${filter.field} filter`);
        for(const page of pages){const option=element('option','',page.name);option.value=page.id;pageSelect.append(option);}
        pageSelect.value=pendingPage;pageSelect.hidden=pendingScope!=='page';
        scopeLabel.append(scopeSelect,pageSelect);controls.append(scopeLabel);
        renderConnectionEditors(controls,type,existing,targets=>{pendingTargets=targets;});
        const connections=controls.querySelector('.filter-connection-list');
        function updateScopeControls(){pageSelect.hidden=pendingScope!=='page';if(connections)connections.hidden=pendingScope!=='charts';}
        scopeSelect.addEventListener('change',()=>{pendingScope=scopeSelect.value;updateScopeControls();});
        pageSelect.addEventListener('change',()=>{pendingPage=pageSelect.value;});
        updateScopeControls();
        const saveConnections=element('button','filter-apply','Save connections');saveConnections.type='button';
        saveConnections.addEventListener('click',()=>{
          if(pendingScope==='charts'&&!pendingTargets.length){const warning=element('p','filters-form-error','Connect this filter to at least one chart.');controls.querySelector('.filters-form-error')?.remove();controls.append(warning);return;}
          try{emitFilters(currentFilters.map(item=>{if(item.id!==filter.id)return item;const next={...item};delete next.targets;delete next.pageId;if(pendingScope==='page'){next.scope='page';next.pageId=pendingPage;}else if(pendingScope==='charts'){next.scope='charts';next.targets=pendingTargets;}else delete next.scope;return next;}));renderFiltersPanel();}
          catch(err){const warning=element('p','filters-form-error',err.message);controls.append(warning);}
        });
        controls.append(saveConnections);
        connectionBox.append(controls);list.append(connectionBox);
      }
    }
    panel.append(list);
    const add=element("button","filter-add","Add filter");add.type="button";add.disabled=!filterTiles.length;add.addEventListener("click",()=>{editingFilterId=null;addFilterOpen=!addFilterOpen;renderFiltersPanel();});
    panel.append(add);
    if(addFilterOpen) panel.append(buildFilterForm(currentFilters.find(filter=>filter.id===editingFilterId)));
  }

  function buildFilterForm(existing = null) {
    const form=element("div","filter-form");
    const legend=element("strong","",existing?'Edit filter':'New filter');form.append(legend);
    const sourceTileLabel=element('label','filter-field-label','Source chart');
    const sourceTileSelect=element('select','filter-field-select');sourceTileSelect.setAttribute('aria-label','Filter source chart');
    const sourcePlaceholder=element('option','','Choose a chart');sourcePlaceholder.value='';sourcePlaceholder.disabled=true;sourcePlaceholder.selected=true;sourceTileSelect.append(sourcePlaceholder);
    for(const tile of filterTiles){const option=element('option','',tile.title);option.value=tile.id;sourceTileSelect.append(option);}
    sourceTileLabel.append(sourceTileSelect);form.append(sourceTileLabel);
    const fieldLabel=element("label","filter-field-label","Source field");
    const fieldSelect=element("select","filter-field-select");fieldSelect.setAttribute("aria-label","Filter field");fieldSelect.disabled=true;
    const fieldPlaceholder=element("option","","Choose a field");fieldPlaceholder.value="";fieldPlaceholder.disabled=true;fieldPlaceholder.selected=true;fieldSelect.append(fieldPlaceholder);
    fieldLabel.append(fieldSelect);form.append(fieldLabel);
    const controls=element("div","filter-value-controls");form.append(controls);
    const scopeLabel=element('label','filter-field-label','Filter scope');
    const scopeSelect=element('select','filter-field-select');scopeSelect.setAttribute('aria-label','Filter scope');
    for(const [value,label] of [['dashboard','Dashboard — matching fields on every page'],['page','Page — matching fields on one page'],['charts','Selected charts — choose connections']]){const option=element('option','',label);option.value=value;scopeSelect.append(option);}
    const pageSelect=element('select','filter-field-select');pageSelect.setAttribute('aria-label','Filter page');pageSelect.hidden=true;
    for(const page of pages){const option=element('option','',page.name);option.value=page.id;pageSelect.append(option);}
    scopeLabel.append(scopeSelect,pageSelect);form.append(scopeLabel);
    const targetWrap=element('div','filter-targets');targetWrap.hidden=true;form.append(targetWrap);
    const error=element("p","filters-form-error");error.hidden=true;form.append(error);
    const actions=element("div","filter-form-actions");
    const cancel=element("button","filter-cancel","Cancel");cancel.type="button";cancel.addEventListener("click",()=>{addFilterOpen=false;renderFiltersPanel();});
    const apply=element("button","filter-apply","Apply filter");apply.type="button";apply.disabled=true;
    actions.append(cancel,apply);form.append(actions);
    let selectedTile=null,selectedField=null,selectedOperator=existing?.op||null,operatorTouched=false,selectedValues=[],selectedTargets=[],targetsTouched=false,selectedRelativePreset=null;

    const showError=message=>{error.textContent=message;error.hidden=!message;};
    const renderControls=()=>{
      controls.replaceChildren();
      const tile=filterTiles.find(option=>option.id===sourceTileSelect.value)||null;
      if(tile!==selectedTile){
        selectedTile=tile;fieldSelect.replaceChildren();
        const placeholder=element('option','','Choose a field');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;fieldSelect.append(placeholder);
        for(const field of tile?.fields||[]){const option=element('option','',`${field.field} · ${field.type==='date'?'Date':field.type==='number'?'Number':'Category'}`);option.value=field.field;fieldSelect.append(option);}
        fieldSelect.disabled=!tile;selectedField=null;selectedValues=[];selectedTargets=[];targetWrap.replaceChildren();apply.disabled=true;return;
      }
      selectedField=selectedTile?.fields.find(option=>option.field===fieldSelect.value)||null;
      selectedValues=[];selectedTargets=[];selectedRelativePreset=null;targetWrap.replaceChildren();apply.disabled=true;
      if(!selectedField)return;
      const rangeType=selectedField.type==='number'||selectedField.type==='date';
      if(!operatorTouched)selectedOperator=existing?.field===selectedField.field?existing.op:(rangeType?(selectedField.type==='date'?'date-between':'between'):'is');
      if(rangeType){
        const operator=element('select','filter-operator');operator.setAttribute('aria-label','Filter match');
        const options=selectedField.type==='number'?[['is','Is'],['is-not','Is not'],['between','Between']]:[['is','Is'],['is-not','Is not'],['date-between','Between dates']];
        for(const [value,label] of options){const option=element('option','',label);option.value=value;operator.append(option);}
        operator.value=selectedOperator||(selectedField.type==='date'?'date-between':'between');selectedOperator=operator.value;
        operator.addEventListener('change',()=>{selectedOperator=operator.value;operatorTouched=true;renderControls();});controls.append(operator);
      }
      if(rangeType&&['between','date-between'].includes(selectedOperator)){
        let preset=null;
        if(selectedField.type==='date'){
          preset=element('select','filter-date-preset');preset.setAttribute('aria-label','Date range preset');
          for(const [value,label] of [['','Custom range'],['last-7-days','Last 7 days'],['last-30-days','Last 30 days'],['month-to-date','Month to date'],['last-month','Last month'],['year-to-date','Year to date']]){const option=element('option','',label);option.value=value;preset.append(option);}
          preset.addEventListener('change',()=>{
            selectedRelativePreset=preset.value||null;
            const [start,end]=selectedRelativePreset?dateRangeForPreset(selectedRelativePreset):['',''];
            min.value=start;max.value=end;min.disabled=max.disabled=!!selectedRelativePreset;
            selectedValues=[min.value,max.value];updateApplyState();
          });
          controls.append(preset);
        }
        const range=element("div","filter-number-range");
        const min=element("input","filter-min");min.type=selectedField.type==='date'?'date':'number';if(min.type==='number')min.step="any";min.setAttribute("aria-label",selectedField.type==='date'?'Start date':'Minimum');
        const max=element("input","filter-max");max.type=selectedField.type==='date'?'date':'number';if(max.type==='number')max.step="any";max.setAttribute("aria-label",selectedField.type==='date'?'End date':'Maximum');
        range.append(min,max);controls.append(range);
        const update=()=>{selectedRelativePreset=null;if(preset)preset.value='';selectedValues=[min.value,max.value];updateApplyState();};
        min.addEventListener("input",update);max.addEventListener("input",update);
      }else if(rangeType){
        const value=element('input','filter-single-value');value.type=selectedField.type==='date'?'date':'number';if(value.type==='number')value.step='any';value.setAttribute('aria-label',selectedField.type==='date'?'Date value':'Number value');value.addEventListener('input',()=>{selectedValues=[value.type==='number'?Number(value.value):value.value];updateApplyState();});controls.append(value);
      }else{
        const operator=element("select","filter-operator");operator.setAttribute("aria-label","Filter match");
        for(const [value,text] of [["is","Is"],["is-not","Is not"]]){const option=element("option","",text);option.value=value;operator.append(option);}
        operator.value=selectedOperator||'is';selectedOperator=operator.value;operator.addEventListener("change",()=>{selectedOperator=operator.value;});controls.append(operator);
        const values=element("div","filter-values");
        for(const value of selectedField.values){
          const label=element("label","filter-value");const checkbox=element("input","");checkbox.type="checkbox";checkbox.value=JSON.stringify(value);
          checkbox.checked=selectedValues.some(item=>Object.is(item,value));
          checkbox.addEventListener("change",()=>{
            const next=new Set(selectedValues);
            const value=JSON.parse(checkbox.value);
            if(checkbox.checked)next.add(value);else next.delete(value);
            selectedValues=[...next];updateApplyState();
          });
          label.append(checkbox,document.createTextNode(value===null?'Blank':String(value)));values.append(label);
        }
        controls.append(values);
        if(selectedField.truncated)controls.append(element("p","filters-overflow","200+ values — narrow with another filter before selecting."));
        if(!selectedField.values.length)controls.append(element("p","filters-help","This field has no filterable values."));
      }
      selectedTargets=defaultTargets(selectedTile.id,selectedField);
      targetsTouched=false;
      renderConnectionEditors(targetWrap,selectedField.type,selectedTargets,(targets)=>{selectedTargets=targets;targetsTouched=true;updateApplyState();});
      scopeSelect.value='dashboard';pageSelect.value=selectedTile.pageId||pages[0]?.id||'';pageSelect.hidden=true;targetWrap.hidden=true;
      updateApplyState();
    };
    function defaultTargets(_sourceTileId,sourceField){
      return filterTiles.flatMap(tile=>tile.fields.some(field=>field.field===sourceField.field&&field.type===sourceField.type)?[{tileId:tile.id,field:sourceField.field}]:[]);
    }
    function updateApplyState(){
      const type=selectedField?.type;
      const scalar=['is','is-not'].includes(selectedOperator);
      const ordered=type==='number'?Number(selectedValues[0])<=Number(selectedValues[1]):selectedValues[0]<=selectedValues[1];
      const validValues=type==='category'?selectedValues.length>0:scalar?selectedValues.length===1&&selectedValues[0]!==''&&(type!=='number'||Number.isFinite(Number(selectedValues[0]))):selectedValues.length===2&&selectedValues.every(value=>value!=='')&&(type!=='number'||selectedValues.every(value=>Number.isFinite(Number(value))))&&ordered;
      apply.disabled=!selectedField||!validValues||(scopeSelect.value==='charts'&&!selectedTargets.length);
    }
    scopeSelect.addEventListener('change',()=>{pageSelect.hidden=scopeSelect.value!=='page';targetWrap.hidden=scopeSelect.value!=='charts';updateApplyState();});
    pageSelect.addEventListener('change',updateApplyState);
    sourceTileSelect.addEventListener('change',()=>{selectedTile=null;fieldSelect.value='';operatorTouched=false;renderControls();});
    fieldSelect.addEventListener("change",()=>{operatorTouched=false;renderControls();});
    if(filterTiles.length){sourceTileSelect.value=filterTiles[0].id;renderControls();}
    if(existing){
      const source=filterTiles.find(tile=>tile.fields.some(field=>field.field===existing.field));
      if(source){
        sourceTileSelect.value=source.id;selectedTile=null;renderControls();
        fieldSelect.value=existing.field;renderControls();
        selectedValues=[...existing.values];selectedOperator=existing.op;
        const operator=controls.querySelector('.filter-operator');if(operator)operator.value=selectedOperator;
        const single=controls.querySelector('.filter-single-value');if(single)single.value=String(existing.values[0]??'');
        const bounds=controls.querySelectorAll('.filter-min,.filter-max');if(bounds.length===2)bounds.forEach((input,index)=>input.value=existing.values[index]??'');
        for(const checkbox of controls.querySelectorAll('input[type="checkbox"]')) checkbox.checked=selectedValues.some(value=>Object.is(value,JSON.parse(checkbox.value)));
        selectedTargets=existing.targets?.map(target=>({...target}))||defaultTargets(source.id,selectedField);
        renderConnectionEditors(targetWrap,selectedField.type,selectedTargets,targets=>{selectedTargets=targets;targetsTouched=true;updateApplyState();});
        scopeSelect.value=existing.scope||(existing.targets?'charts':'dashboard');
        pageSelect.value=existing.pageId||source.pageId||pages[0]?.id||'';
        pageSelect.hidden=scopeSelect.value!=='page';targetWrap.hidden=scopeSelect.value!=='charts';updateApplyState();
      }
    }
    apply.addEventListener("click",()=>{
      if(!selectedField)return;
      let filter;
      if(scopeSelect.value==='charts'&&!selectedTargets.length){showError('Connect this filter to at least one chart.');return;}
      const scopeOptions=scopeSelect.value==='page'?{scope:'page',pageId:pageSelect.value}:scopeSelect.value==='charts'?{scope:'charts',targets:selectedTargets}:{scope:'dashboard'};
      if(selectedField.type==='number'&&['is','is-not'].includes(selectedOperator)){
        filter={id:existing?.id||newId('filter'),field:selectedField.field,op:selectedOperator,values:[Number(selectedValues[0])],...scopeOptions};
      }else if(selectedField.type==='number'){
        const [min,max]=selectedValues.map(Number);
        if(!Number.isFinite(min)||!Number.isFinite(max)||min>max){showError("Enter a valid minimum and maximum.");return;}
        filter={id:existing?.id||newId('filter'),field:selectedField.field,op:'between',values:[min,max],...scopeOptions};
      }else if(selectedField.type==='date'&&['is','is-not'].includes(selectedOperator)){
        filter={id:existing?.id||newId('filter'),field:selectedField.field,op:selectedOperator,values:[selectedValues[0]],...scopeOptions};
      }else if(selectedField.type==='date'){
        filter={id:existing?.id||newId('filter'),field:selectedField.field,op:'date-between',values:selectedValues,...(selectedRelativePreset?{relativePreset:selectedRelativePreset}:{}),...scopeOptions};
      }else filter={id:existing?.id||newId('filter'),field:selectedField.field,op:selectedOperator,values:selectedValues,...scopeOptions};
      try{emitFilters([...currentFilters.filter(filter=>filter.id!==existing?.id),filter]);addFilterOpen=false;editingFilterId=null;renderFiltersPanel();}
      catch(err){showError(err.message);}
    });
    return form;
  }

  function renderConnectionEditors(container,type,initial,onChange){
    container.replaceChildren();
    if(container.classList.contains('filter-targets'))container.append(element('strong','','Connect to charts'));
    const selected=new Map(initial.map(target=>[target.tileId,target.field]));
    for(const tile of filterTiles){
      const row=element('label','filter-connection-row',tile.title);
      const select=element('select','filter-connection-select');select.setAttribute('aria-label',`Field for ${tile.title}`);
      const skip=element('option','','Do not filter');skip.value='';select.append(skip);
      for(const field of tile.fields.filter(item=>item.type===type)){
        const option=element('option','',field.field);option.value=field.field;select.append(option);
      }
      const selectedField=selected.get(tile.id);
      if(selectedField&&!tile.fields.some(field=>field.field===selectedField&&field.type===type)){
        const missing=element('option','',`${selectedField} (unavailable or incompatible)`);missing.value=selectedField;select.append(missing);
      }
      select.value=selectedField||'';
      select.addEventListener('change',()=>{
        if(select.value)selected.set(tile.id,select.value);else selected.delete(tile.id);
        onChange([...selected].map(([tileId,field])=>({tileId,field})));
      });
      row.append(select);container.append(row);
    }
  }

  const parameterTypes=[["number","Number"],["text","Text"],["boolean","Boolean"],["date","Date"],["date-range","Date range"],["number-range","Number range"],["single-select","Single select"],["multi-select","Multiple select"]];
  function parameterColumns(dataset) {
    if (!dataset) return [];
    if (dataset.startsWith('upload:')) return getDataset(dataset.slice(7))?.columns || [];
    return DATASETS[dataset] ? [...new Set(DATASETS[dataset].flatMap(row=>Object.keys(row)))] : [];
  }
  function parameterRows(dataset) {
    if (!dataset) return [];
    if (dataset.startsWith('upload:')) { const item=getDataset(dataset.slice(7)); return item?.raw?.rows || item?.rows || []; }
    return DATASETS[dataset] || [];
  }
  function datasetChoices() {
    const choices=[...Object.keys(DATASETS).map(id=>({id,label:DATASET_LABELS[id]||id})),...listDatasets().map(item=>({id:`upload:${item.id}`,label:`${item.name} (uploaded)`}))];
    return choices.filter(item=>!(defaultDataset?.kind==='dataset'&&item.id===defaultDataset.ref));
  }
  function sourceControls(container, parameter, onRefresh, labelPrefix='') {
    const wrap=element('div','parameter-source-controls');
    const datasets=datasetChoices();
    const datasetLabel=element('label','parameter-value-label',`${labelPrefix}Dataset`);
    const dataset=element('select','parameter-source-dataset');dataset.setAttribute('aria-label',`${labelPrefix}Source dataset`);
    const placeholder=element('option','','Choose a dataset');placeholder.value='';dataset.append(placeholder);
    for(const item of datasets){const option=element('option','',item.label);option.value=item.id;dataset.append(option);}
    dataset.value=parameter.source?.dataset||'';datasetLabel.append(dataset);wrap.append(datasetLabel);
    const columnLabel=element('label','parameter-value-label',`${labelPrefix}Column`);
    const column=element('select','parameter-source-column');column.setAttribute('aria-label',`${labelPrefix}Source column`);
    const empty=element('option','','Choose a column');empty.value='';column.append(empty);
    for(const key of parameterColumns(dataset.value)){const option=element('option','',key);option.value=key;column.append(option);}
    column.value=parameter.source?.column||'';columnLabel.append(column);wrap.append(columnLabel);
    const selected={...parameter,source:parameter.source?{...parameter.source}:{dataset:dataset.value,column:column.value}};
    dataset.addEventListener('change',()=>{selected.source={dataset:dataset.value,column:''};while(column.options.length>1)column.remove(1);for(const key of parameterColumns(dataset.value)){const option=element('option','',key);option.value=key;column.append(option);}column.value='';});
    column.addEventListener('change',()=>{selected.source={dataset:dataset.value,column:column.value};});
    const refresh=element('button','filter-add parameter-refresh-options','Refresh options');refresh.type='button';
    refresh.addEventListener('click',()=>{
      if(!dataset.value||!column.value){onRefresh(null,'Choose an explicit dataset and column before refreshing options.');return;}
      try { const enumerated=enumerateParameterOptions(parameterRows(dataset.value),column.value);onRefresh({source:{dataset:dataset.value,column:column.value},...enumerated},null);preview.replaceChildren(element('p','',`${enumerated.options.length} stored option${enumerated.options.length===1?'':'s'}${enumerated.overflow?` of ${enumerated.overflow.distinctCount} distinct values (200 shown)`:(enumerated.options.length===200?' (maximum 200)':'')}.`));const chips=element('div','parameter-option-chips');for(const item of enumerated.options.slice(0,12))chips.append(element('span','parameter-option-chip',item));if(enumerated.options.length>12)chips.append(element('span','parameter-option-chip',`+${enumerated.options.length-12} more`));preview.append(chips); }
      catch(error){onRefresh(null,error.message);}
    });
    wrap.append(refresh);container.append(wrap);
    const preview=element('div','parameter-option-preview');
    if(parameter.options?.length){preview.append(element('p','',`${parameter.options.length} stored option${parameter.options.length===1?'':'s'}${parameter.overflow?` of ${parameter.overflow.distinctCount} distinct values (200 shown)`:(parameter.options.length===200?' (maximum 200)':'')}.`));const chips=element('div','parameter-option-chips');for(const item of parameter.options.slice(0,12))chips.append(element('span','parameter-option-chip',item));if(parameter.options.length>12)chips.append(element('span','parameter-option-chip',`+${parameter.options.length-12} more`));preview.append(chips);}
    else preview.append(element('p','','No options stored. Choose a source and refresh options.'));
    container.append(preview);
    return {dataset,column};
  }
  function renderParametersPanel() {
    activeTab="parameters";
    filtersTab.classList.remove("active");parametersTab.classList.add("active");
    filtersTab.setAttribute("aria-selected","false");parametersTab.setAttribute("aria-selected","true");
    panel.id="dashboard-parameters-panel";panel.className="data-panel dashboard-parameters-panel";panel.replaceChildren();
    panel.append(element("p","filters-help","Use {{name}} in SQL. Numbers and booleans are inserted as literals; dates and selected text are quoted."));
    panel.append(element("code","parameter-example","SELECT *, value * {{growth}} AS projected FROM categorical"));
    const list=element("div","dashboard-parameter-list");
    for(const parameter of currentParameters){
      const row=element("div","dashboard-parameter");
      const nameLabel=element("label","parameter-name-label","Name");const name=element("input","parameter-name");name.type='text';name.value=parameter.name;name.maxLength=64;name.setAttribute('aria-label',`Rename parameter ${parameter.name}`);nameLabel.append(name);row.append(nameLabel);
      const typeLabel=element("label","parameter-type-label","Type");const type=element("select","parameter-type");type.setAttribute('aria-label',`Type for ${parameter.name}`);for(const [v,label] of parameterTypes){const option=element('option','',label);option.value=v;type.append(option);}type.value=parameter.type;typeLabel.append(type);row.append(typeLabel);
      const editor=element('div','parameter-editor');
      const updateValue=value=>updateParameter(parameter.name,{value},row);
      if(parameter.type==='number'){
        const label=element('label','parameter-value-label','Value');const value=element('input','parameter-value');value.type='number';value.value=String(parameter.value);value.step=parameter.integer?String(parameter.step??1):parameter.step===undefined?'any':String(parameter.step);value.setAttribute('aria-label',`Value for ${parameter.name}`);value.addEventListener('change',()=>updateValue(Number(value.value)));label.append(value);
        if(parameter.min!==undefined&&parameter.max!==undefined){const slider=element('input','parameter-slider');slider.type='range';slider.min=String(parameter.min);slider.max=String(parameter.max);slider.step=parameter.integer?String(parameter.step??1):parameter.step===undefined?'any':String(parameter.step);slider.value=String(parameter.value);slider.setAttribute('aria-label',`Slider for ${parameter.name}`);slider.addEventListener('input',()=>{value.value=slider.value;});slider.addEventListener('change',()=>updateValue(Number(slider.value)));value.addEventListener('input',()=>{const numeric=Number(value.value);if(Number.isFinite(numeric)&&numeric>=parameter.min&&numeric<=parameter.max)slider.value=String(numeric);});label.append(slider);}
        editor.append(label);
        const settings=element('div','parameter-number-settings');for(const key of ['min','max']){const bound=element('label','parameter-value-label',key==='min'?'Minimum':'Maximum');const input=element('input',`parameter-${key}`);input.type='number';input.step='any';input.value=parameter[key]===undefined?'':String(parameter[key]);input.setAttribute('aria-label',`${key==='min'?'Minimum':'Maximum'} for ${parameter.name}`);input.addEventListener('change',()=>updateParameter(parameter.name,{[key]:input.value===''?undefined:Number(input.value)},row));bound.append(input);settings.append(bound);}const stepLabel=element('label','parameter-value-label','Step');const step=element('input','parameter-step');step.type='number';step.min='0';step.step='any';step.value=parameter.step===undefined?'':String(parameter.step);step.placeholder='Any';step.setAttribute('aria-label',`Step for ${parameter.name}`);step.addEventListener('change',()=>updateParameter(parameter.name,{step:step.value===''?undefined:Number(step.value)},row));stepLabel.append(step);settings.append(stepLabel);
        const integerLabel=element('label','parameter-check-label');const integer=element('input','parameter-integer');integer.type='checkbox';integer.checked=parameter.integer===true;integer.setAttribute('aria-label',`Integer values for ${parameter.name}`);integer.addEventListener('change',()=>updateParameter(parameter.name,{integer:integer.checked},row));integerLabel.append(integer,document.createTextNode(' Integer values'));settings.append(integerLabel);editor.append(settings);
      } else if(parameter.type==='text'){
        const label=element('label','parameter-value-label','Text value');const value=element('input','parameter-value');value.type='text';value.value=parameter.value;value.maxLength=10000;value.setAttribute('aria-label',`Value for ${parameter.name}`);value.addEventListener('change',()=>updateValue(value.value));label.append(value);editor.append(label);
      } else if(parameter.type==='boolean'){
        const label=element('label','parameter-check-label');const value=element('input','parameter-value');value.type='checkbox';value.checked=parameter.value;value.setAttribute('aria-label',`Value for ${parameter.name}`);value.addEventListener('change',()=>updateValue(value.checked));label.append(value,document.createTextNode(' Enabled'));editor.append(label);
      } else if(parameter.type==='date'){
        const label=element('label','parameter-value-label','Date');const value=element('input','parameter-value');value.type='date';value.value=parameter.value;value.setAttribute('aria-label',`Value for ${parameter.name}`);value.addEventListener('change',()=>updateValue(value.value));label.append(value);editor.append(label);
      } else if(parameter.type==='date-range'||parameter.type==='number-range'){
        const date=parameter.type==='date-range';const bounds=element('div','parameter-range-bounds');
        for(const [key,title] of [['from','Lower'],['to','Upper']]){const group=element('div','parameter-bound');const label=element('label','parameter-value-label',`${title} bound`);const value=element('input','parameter-bound-value');value.type=date?'date':'number';if(!date)value.step='any';value.value=parameter.value[key]===null?'':String(parameter.value[key]);value.disabled=parameter.value[key]===null;value.setAttribute('aria-label',`${title} bound for ${parameter.name}`);const openLabel=element('label','parameter-check-label');const open=element('input','parameter-open-bound');open.type='checkbox';open.checked=parameter.value[key]===null;open.setAttribute('aria-label',`No ${key==='from'?'lower':'upper'} bound for ${parameter.name}`);open.addEventListener('change',()=>{const next={...parameter.value,[key]:open.checked?null:(date?'':Number(value.value))};if(!open.checked&&!date&&value.value===''){showParameterError(row,`Enter the ${title.toLowerCase()} bound or leave it open.`);return;}updateValue(next);});value.addEventListener('change',()=>updateValue({...parameter.value,[key]:date?value.value:Number(value.value)}));label.append(value);openLabel.append(open,document.createTextNode(` No ${key==='from'?'lower':'upper'} bound`));group.append(label,openLabel);bounds.append(group);}
        editor.append(bounds);
      } else {
        const select=element('select','parameter-select-value');select.setAttribute('aria-label',`Value for ${parameter.name}`);
        const selected=parameter.type==='single-select'?[parameter.value]:parameter.value;const all=[...parameter.options,...selected.filter(value=>!parameter.options.includes(value))];for(const item of all){const option=element('option','',`${item}${parameter.options.includes(item)?'':' (stale)'}`);option.value=item;select.append(option);}select.multiple=parameter.type==='multi-select';if(select.multiple){for(const option of select.options)option.selected=selected.includes(option.value);}else select.value=parameter.value;select.addEventListener('change',()=>updateValue(select.multiple?[...select.selectedOptions].map(option=>option.value):select.value));editor.append(select);
        const stale=parameter.type==='single-select'?parameter.stale:parameter.staleValues.length>0;if(stale)editor.append(element('p','parameter-stale-flag',parameter.type==='single-select'?`“${parameter.value}” is stale and is preserved.`:`${parameter.staleValues.length} selected value${parameter.staleValues.length===1?'':'s'} are stale and preserved: ${parameter.staleValues.join(', ')}`));
        const source=sourceControls(editor,parameter,(result,error)=>{if(error){showParameterError(row,error);return;}const nextValue=parameter.type==='single-select'?parameter.value:parameter.value;updateParameter(parameter.name,{source:result.source,options:result.options,...(result.overflow?{overflow:result.overflow}:{overflow:undefined}),value:nextValue},row);});
      }
      row.append(editor);
      const bindingBox=element('div','parameter-binding-editor');
      const bindingLabel=element('label','parameter-value-label','Filter binding');
      const bindingSelect=element('select','parameter-filter-binding');bindingSelect.setAttribute('aria-label',`Filter binding for ${parameter.name}`);
      const none=element('option','','Not bound');none.value='';bindingSelect.append(none);
      const activeBinding=parameterFilterBinding(parameter);
      for(const filter of currentFilters.filter(item=>item.source!=='crossfilter')){
        const owner=currentParameters.find(item=>item.name!==parameter.name&&parameterFilterBinding(item)?.filterId===filter.id);
        const option=element('option','',`${filter.field} · ${filter.op}${owner?` (bound to ${owner.name})`:''}`);option.value=filter.id;option.disabled=!!owner;bindingSelect.append(option);
      }
      bindingSelect.value=activeBinding?.filterId||'';
      bindingSelect.addEventListener('change',()=>{
        const filter=currentFilters.find(item=>item.id===bindingSelect.value);
        if(!filter){updateParameter(parameter.name,{bindings:undefined},row);return;}
        const reason=bindingCompatibilityError(parameter,filter,filterFieldInfos(filter));
        if(reason){bindingSelect.value=activeBinding?.filterId||'';showParameterError(row,reason);return;}
        updateParameter(parameter.name,{bindings:[{kind:'filter',filterId:filter.id}]},row);
      });
      bindingLabel.append(bindingSelect);bindingBox.append(bindingLabel);
      if(activeBinding){const activeFilter=currentFilters.find(item=>item.id===activeBinding.filterId);const conflict=bindingConflict(parameter,activeFilter);if(conflict){const status=element('p','parameter-binding-conflict',conflict);status.setAttribute('role','alert');bindingBox.append(status);}else bindingBox.append(element('p','parameter-binding-status',`Bound to “${activeFilter?.field||activeBinding.filterId}”.`));}
      row.append(bindingBox);
      const remove=element('button','parameter-delete','Delete');remove.type='button';remove.setAttribute('aria-label',`Delete parameter ${parameter.name}`);remove.addEventListener('click',()=>requestParameterOperation(parameter.name,null,row,'delete'));row.append(remove);
      name.addEventListener('change',()=>updateParameter(parameter.name,{name:name.value},row));
      type.addEventListener('change',()=>{
        const target=type.value;let value=parameter.value;
        if(parameterConsumers(parameter.name,currentQueries,currentViews,currentFilters,currentParameters).length){type.value=parameter.type;requestParameterOperation(parameter.name,{name:parameter.name,type:target,value},row,'change type');return;}
        if(target==='select')return;
        if(target==='single-select'||target==='multi-select'){
          const pending=row.querySelector('.parameter-pending-select')||element('div','parameter-pending-select');
          pending.replaceChildren(element('p','filters-help','Choose an explicit source, then refresh to store its options and change this parameter type.'));
          sourceControls(pending,{source:{dataset:'',column:''},options:[]},(result,error)=>{
            if(error){showParameterError(row,error);return;}
            const changes={name:parameter.name,type:target,value:target==='single-select'?(result.options[0]??''):[],source:result.source,options:result.options,...(result.overflow?{overflow:result.overflow}:{})};
            requestParameterOperation(parameter.name,changes,row,'change type');
          },'Select ');
          row.append(pending);return;
        }
        if(target==='text')value=String(parameter.value);
        else if(target==='number'){if(!Number.isFinite(Number(parameter.value))||String(parameter.value).trim()===''){type.value=parameter.type;showParameterError(row,`Enter a finite numeric value before changing ${parameter.name} to Number.`);return;}value=Number(parameter.value);}
        else if(target==='boolean'){if(typeof value!=='boolean'){if(value==='true'||value==='false')value=value==='true';else if(value===0||value===1)value=Boolean(value);else{type.value=parameter.type;showParameterError(row,`Set ${parameter.name} to true or false before changing its type.`);return;}}}
        else if(target==='date'){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)){type.value=parameter.type;showParameterError(row,`Enter a YYYY-MM-DD value before changing ${parameter.name} to Date.`);return;}}
        else if(target==='number-range'||target==='date-range'){const isDate=target==='date-range';if(parameter.type==='number-range'||parameter.type==='date-range'){}else if(isDate&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))value={from:value,to:value};else if(!isDate&&Number.isFinite(Number(value)))value={from:Number(value),to:Number(value)};else{type.value=parameter.type;showParameterError(row,`Enter a compatible ${isDate?'date':'number'} value before changing ${parameter.name} to a range.`);return;}}
        const changes={name:parameter.name,type:target,value};
        if(target==='number'&&parameter.type==='number')for(const key of ['min','max','step','integer'])if(parameter[key]!==undefined)changes[key]=parameter[key];
        updateParameter(parameter.name,changes,row);
      });
      list.append(row);
    }
    panel.append(list);
    const add=element('button','filter-add parameter-add','Add parameter');add.type='button';add.addEventListener('click',()=>{addParameterOpen=!addParameterOpen;renderParametersPanel();});panel.append(add);
    if(addParameterOpen)panel.append(buildParameterForm());
  }

  function updateParameter(name,changes,row) {
    const original=currentParameters.find(parameter=>parameter.name===name);
    if(original&&changes.name===name&&changes.type===undefined)return;
    if(Object.hasOwn(changes,'name')||Object.hasOwn(changes,'type'))return requestParameterOperation(name,changes,row,Object.hasOwn(changes,'name')?'rename':'change type');
    try{emitParameters(currentParameters.map(parameter=>parameter.name===name?{...parameter,...changes}:parameter));renderParametersPanel();}
    catch(err){if(changes.type&&original)row.querySelector('.parameter-type').value=original.type;showParameterError(row,err.message);}
  }

  function showParameterError(row,message) {
    const error=row.querySelector('.filters-form-error')||element('p','filters-form-error');
    error.textContent=message;error.hidden=false;if(!error.isConnected)row.append(error);
  }

  function requestParameterOperation(name,changes,row,operation) {
    const consumers=parameterConsumers(name,currentQueries,currentViews,currentFilters,currentParameters);
    if(!consumers.length){
      try{
        emitParameters(changes===null?currentParameters.filter(parameter=>parameter.name!==name):currentParameters.map(parameter=>parameter.name===name?{...parameter,...changes}:parameter));
        renderParametersPanel();
      }catch(err){if(changes?.type)row.querySelector('.parameter-type').value=currentParameters.find(parameter=>parameter.name===name)?.type||'';showParameterError(row,err.message);}
      return;
    }
    const warning=element('div','parameter-consumer-warning');
    warning.setAttribute('role','alert');
    const action=operation==='change type'?'change the type of':operation;
    warning.append(element('p','',`Cannot ${action} parameter “${name}” while consumers exist.`));
    for(const consumer of consumers)warning.append(element('p','parameter-consumer-name',consumer.label));
    const groups=new Map();
    for(const consumer of consumers){if(!groups.has(consumer.kind))groups.set(consumer.kind,[]);groups.get(consumer.kind).push(consumer);}
    for(const [kind,group] of groups){
      const detach=element('button','parameter-detach-consumers',`Detach ${parameterConsumerKindLabel(kind)} consumers`);detach.type='button';
      detach.addEventListener('click',()=>{
        try{
          if(kind==='filter')emitParameters(currentParameters.map(parameter=>parameter.name===name?{...parameter,bindings:undefined}:parameter));
          else {const updated=onDetachParameterConsumers?.(name,kind,group)||{};currentQueries=updated.queries||currentQueries;currentViews=updated.savedViews||currentViews;}
          const remaining=parameterConsumers(name,currentQueries,currentViews,currentFilters,currentParameters);
          if(!remaining.length){
            emitParameters(changes===null?currentParameters.filter(parameter=>parameter.name!==name):currentParameters.map(parameter=>parameter.name===name?{...parameter,...changes}:parameter));
            renderParametersPanel();
          }else requestParameterOperation(name,changes,row,operation);
        }catch(err){showParameterError(row,err.message);}
      });
      warning.append(detach);
    }
    row.querySelector('.parameter-consumer-warning')?.remove();row.append(warning);
  }

  function buildParameterForm() {
    const form=element('div','filter-form parameter-form');form.append(element('strong','','New parameter'));
    const nameLabel=element('label','','Name');const name=element('input','');name.type='text';name.value=`parameter${currentParameters.length+1}`;name.maxLength=64;name.setAttribute('aria-label','New parameter name');nameLabel.append(name);form.append(nameLabel);
    const typeLabel=element('label','','Type');const type=element('select','');type.setAttribute('aria-label','New parameter type');for(const [v,label] of parameterTypes){const option=element('option','',label);option.value=v;type.append(option);}typeLabel.append(type);form.append(typeLabel);
    const editor=element('div','parameter-editor');form.append(editor);const error=element('p','filters-form-error');error.hidden=true;form.append(error);
    let draft={type:'number',value:1};
    const draw=()=>{editor.replaceChildren();draft={type:type.value,...(type.value==='number'?{value:1}:type.value==='text'?{value:''}:type.value==='boolean'?{value:false}:type.value==='date'?{value:new Date().toISOString().slice(0,10)}:type.value==='date-range'?{value:{from:null,to:new Date().toISOString().slice(0,10)}}:type.value==='number-range'?{value:{from:null,to:1}}:type.value==='single-select'?{value:'',source:{dataset:'',column:''},options:[]}:{value:[],source:{dataset:'',column:''},options:[]})};
      if(draft.type==='number'||draft.type==='text'||draft.type==='date'){const label=element('label','parameter-value-label',draft.type==='text'?'Text value':'Value');const input=element('input','');input.type=draft.type==='number'?'number':draft.type==='date'?'date':'text';input.value=String(draft.value);input.step='any';input.setAttribute('aria-label','New parameter value');input.addEventListener('input',()=>draft.value=draft.type==='number'?Number(input.value):input.value);label.append(input);editor.append(label);if(draft.type==='number'){for(const key of ['min','max']){const bound=element('label','parameter-value-label',key==='min'?'Minimum':'Maximum');const field=element('input','');field.type='number';field.step='any';field.setAttribute('aria-label',key==='min'?'Parameter minimum':'Parameter maximum');field.addEventListener('input',()=>draft[key]=field.value===''?undefined:Number(field.value));bound.append(field);editor.append(bound);}const stepLabel=element('label','parameter-value-label','Step');const step=element('input','');step.type='number';step.min='0';step.step='any';step.setAttribute('aria-label','Parameter step');step.addEventListener('input',()=>draft.step=step.value===''?undefined:Number(step.value));stepLabel.append(step);editor.append(stepLabel);const check=element('label','parameter-check-label');const integer=element('input','');integer.type='checkbox';integer.setAttribute('aria-label','Integer values');integer.addEventListener('change',()=>draft.integer=integer.checked);check.append(integer,document.createTextNode(' Integer values'));editor.append(check);}}
      else if(draft.type==='boolean'){const label=element('label','parameter-check-label');const input=element('input','');input.type='checkbox';input.setAttribute('aria-label','New parameter value');input.addEventListener('change',()=>draft.value=input.checked);label.append(input,document.createTextNode(' Enabled'));editor.append(label);}
      else if(draft.type.endsWith('range')){const date=draft.type==='date-range';for(const [key,title]of [['from','Lower'],['to','Upper']]){const bound=element('div','parameter-bound');const label=element('label','parameter-value-label',`${title} bound`);const input=element('input','');input.type=date?'date':'number';input.step='any';input.setAttribute('aria-label',`${title} bound`);input.addEventListener('input',()=>draft.value[key]=date?input.value:Number(input.value));label.append(input);const open=element('input','');open.type='checkbox';open.checked=key==='from';open.setAttribute('aria-label',`No ${key==='from'?'lower':'upper'} bound`);if(open.checked)input.disabled=true;open.addEventListener('change',()=>{draft.value[key]=open.checked?null:(date?input.value:Number(input.value));input.disabled=open.checked;});label.append(open,document.createTextNode(` No ${key==='from'?'lower':'upper'} bound`));bound.append(label);editor.append(bound);}}
      else {const result=sourceControls(editor,draft,(enumerated,reason)=>{if(reason){error.textContent=reason;error.hidden=false;return;}draft={...draft,source:enumerated.source,options:enumerated.options,...(enumerated.overflow?{overflow:enumerated.overflow}:{})};error.textContent='Options refreshed and stored.';error.hidden=false;},'Select ');}
    };
    type.addEventListener('change',draw);draw();
    const actions=element('div','filter-form-actions');const cancel=element('button','filter-cancel','Cancel');cancel.type='button';cancel.addEventListener('click',()=>{addParameterOpen=false;renderParametersPanel();});const create=element('button','filter-apply','Create parameter');create.type='button';create.addEventListener('click',()=>{
      const candidate={name:name.value.trim(),...draft};if(candidate.type==='single-select'||candidate.type==='multi-select'){if(!candidate.source?.dataset||!candidate.source?.column){error.textContent='Choose an explicit dataset and column, then refresh options before creating this select parameter.';error.hidden=false;return;}candidate.value=candidate.type==='single-select'?(candidate.options[0]??''):[];}
      try{emitParameters([...currentParameters,candidate]);addParameterOpen=false;renderParametersPanel();}catch(err){error.textContent=err.message;error.hidden=false;}
    });actions.append(cancel,create);form.append(actions);return form;
  }

  filtersTab.addEventListener("click",renderFiltersPanel);
  parametersTab.addEventListener("click",renderParametersPanel);
  renderFiltersPanel();
  outsideHandler=e=>{
    if(!popover)return;
    const rect=anchor?.getBoundingClientRect();
    const hitAnchor=rect&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;
    if((!popover.contains(e.target)&&!anchor?.contains(e.target))||(hitAnchor&&e.target!==anchor))closeFiltersPopover();
  };
  keyHandler=e=>{if(e.key==='Escape')closeFiltersPopover();};
  document.addEventListener("pointerdown",outsideHandler);
  document.addEventListener("keydown",keyHandler);
}
