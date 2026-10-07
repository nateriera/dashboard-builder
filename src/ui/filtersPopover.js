import { anchorPopover } from "./anchoredPopover.js";
import { dateRangeForPreset, validateFilters } from "../data/filters.js";
import { validateParameters } from "../data/parameters.js";

let popover = null;
let anchor = null;
let releaseAnchor = null;
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
  document.removeEventListener("pointerdown",outsideHandler);
  document.removeEventListener("keydown",keyHandler);
  popover.remove(); popover=null; anchor=null;
}

export function toggleFiltersPopover(options) {
  if (popover && anchor===options.anchor) { closeFiltersPopover(); return; }
  closeFiltersPopover();
  openFiltersPopover(options);
}

function openFiltersPopover({ anchor: nextAnchor, filters, parameters, tiles = [], pages = [], tileTitle, onFiltersChange, onParametersChange }) {
  anchor=nextAnchor;
  const filterTiles=tiles;
  let currentFilters=validateFilters(filters);
  let currentParameters=validateParameters(parameters);
  let activeTab="filters";
  let addFilterOpen=false;
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
  releaseAnchor=anchorPopover(pop,anchor);

  const emitFilters=next=>{
    currentFilters=validateFilters(next);
    onFiltersChange(currentFilters);
  };
  const emitParameters=next=>{
    currentParameters=validateParameters(next);
    onParametersChange(currentParameters);
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
      const caption=element("span","",`${filterDescription(filter)} · ${scopeName}`);
      const remove=element("button","filter-remove","×");remove.type="button";remove.title=`Remove ${filter.field} filter`;remove.setAttribute("aria-label",`Remove ${filter.field} filter`);
      remove.addEventListener("click",()=>{emitFilters(currentFilters.filter(item=>item.id!==filter.id));renderFiltersPanel();});
      chip.append(caption,remove);list.append(chip);
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
    const add=element("button","filter-add","Add filter");add.type="button";add.disabled=!filterTiles.length;add.addEventListener("click",()=>{addFilterOpen=!addFilterOpen;renderFiltersPanel();});
    panel.append(add);
    if(addFilterOpen) panel.append(buildFilterForm());
  }

  function buildFilterForm() {
    const form=element("div","filter-form");
    const legend=element("strong","","New filter");form.append(legend);
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
    let selectedTile=null,selectedField=null,selectedOperator="is",selectedValues=[],selectedTargets=[],targetsTouched=false,selectedRelativePreset=null;

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
      if(selectedField.type==='number'||selectedField.type==='date'){
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
      }else{
        const operator=element("select","filter-operator");operator.setAttribute("aria-label","Filter match");
        for(const [value,text] of [["is","Is"],["is-not","Is not"]]){const option=element("option","",text);option.value=value;operator.append(option);}
        operator.value=selectedOperator;operator.addEventListener("change",()=>{selectedOperator=operator.value;});controls.append(operator);
        const values=element("div","filter-values");
        for(const [index,value] of selectedField.values.entries()){
          const label=element("label","filter-value");const checkbox=element("input","");checkbox.type="checkbox";checkbox.value=String(index);
          checkbox.addEventListener("change",()=>{
            const next=new Set(selectedValues);
            if(checkbox.checked)next.add(index);else next.delete(index);
            selectedValues=[...next].map(i=>selectedField.values[i]);updateApplyState();
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
      const ordered=type==='number'?Number(selectedValues[0])<=Number(selectedValues[1]):selectedValues[0]<=selectedValues[1];
      const validValues=type==='category'?selectedValues.length>0:selectedValues.length===2&&selectedValues.every(value=>value!=='')&&(type!=='number'||selectedValues.every(value=>Number.isFinite(Number(value))))&&ordered;
      apply.disabled=!selectedField||!validValues||(scopeSelect.value==='charts'&&!selectedTargets.length);
    }
    scopeSelect.addEventListener('change',()=>{pageSelect.hidden=scopeSelect.value!=='page';targetWrap.hidden=scopeSelect.value!=='charts';updateApplyState();});
    pageSelect.addEventListener('change',updateApplyState);
    sourceTileSelect.addEventListener('change',()=>{selectedTile=null;fieldSelect.value='';renderControls();});
    fieldSelect.addEventListener("change",renderControls);
    if(filterTiles.length){sourceTileSelect.value=filterTiles[0].id;renderControls();}
    apply.addEventListener("click",()=>{
      if(!selectedField)return;
      let filter;
      if(scopeSelect.value==='charts'&&!selectedTargets.length){showError('Connect this filter to at least one chart.');return;}
      const scopeOptions=scopeSelect.value==='page'?{scope:'page',pageId:pageSelect.value}:scopeSelect.value==='charts'?{scope:'charts',targets:selectedTargets}:{scope:'dashboard'};
      if(selectedField.type==='number'){
        const [min,max]=selectedValues.map(Number);
        if(!Number.isFinite(min)||!Number.isFinite(max)||min>max){showError("Enter a valid minimum and maximum.");return;}
        filter={id:newId('filter'),field:selectedField.field,op:'between',values:[min,max],...scopeOptions};
      }else if(selectedField.type==='date'){
        filter={id:newId('filter'),field:selectedField.field,op:'date-between',values:selectedValues,...(selectedRelativePreset?{relativePreset:selectedRelativePreset}:{}),...scopeOptions};
      }else filter={id:newId('filter'),field:selectedField.field,op:selectedOperator,values:selectedValues,...scopeOptions};
      try{emitFilters([...currentFilters,filter]);addFilterOpen=false;renderFiltersPanel();}
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

  function renderParametersPanel() {
    activeTab="parameters";
    filtersTab.classList.remove("active");parametersTab.classList.add("active");
    filtersTab.setAttribute("aria-selected","false");parametersTab.setAttribute("aria-selected","true");
    panel.id="dashboard-parameters-panel";panel.className="data-panel dashboard-parameters-panel";
    panel.replaceChildren();
    panel.append(element("p","filters-help","Use {{name}} in SQL. Numbers are inserted as numbers; text is safely quoted."));
    const example=element("code","parameter-example","SELECT *, value * {{growth}} AS projected FROM categorical");panel.append(example);
    const list=element("div","dashboard-parameter-list");
    for(const parameter of currentParameters){
      const row=element("div","dashboard-parameter");
      const nameLabel=element("label","parameter-name-label","Name");
      const name=element("input","parameter-name");name.type="text";name.value=parameter.name;name.maxLength=64;name.setAttribute("aria-label",`Rename parameter ${parameter.name}`);
      nameLabel.append(name);row.append(nameLabel);
      const valueLabel=element("label","parameter-value-label",parameter.type==='number'?'Value':'Text value');
      let value;
      if(parameter.type==='number'&&parameter.min!==undefined&&parameter.max!==undefined){
        value=element("input","parameter-slider");value.type="range";value.min=String(parameter.min);value.max=String(parameter.max);value.step="any";value.value=String(parameter.value);value.setAttribute("aria-label",`Value for ${parameter.name}`);
        const output=element("output","parameter-output",String(parameter.value));
        value.addEventListener("input",()=>{output.value=value.value;output.textContent=value.value;});
        value.addEventListener("change",()=>updateParameter(parameter.name,{value:Number(value.value)},row));
        valueLabel.append(value,output);
      }else{
        value=element("input","parameter-value");value.type=parameter.type==='number'?'number':'text';value.value=String(parameter.value);value.maxLength=10000;if(parameter.type==='number')value.step="any";value.setAttribute("aria-label",`Value for ${parameter.name}`);
        value.addEventListener("change",()=>updateParameter(parameter.name,{value:parameter.type==='number'?Number(value.value):value.value},row));
        valueLabel.append(value);
      }
      row.append(valueLabel);
      const remove=element("button","parameter-delete","Delete");remove.type="button";remove.setAttribute("aria-label",`Delete parameter ${parameter.name}`);
      remove.addEventListener("click",()=>{emitParameters(currentParameters.filter(item=>item.name!==parameter.name));renderParametersPanel();});
      name.addEventListener("change",()=>updateParameter(parameter.name,{name:name.value},row));
      row.append(remove);list.append(row);
    }
    panel.append(list);
    const add=element("button","filter-add parameter-add","Add parameter");add.type="button";add.addEventListener("click",()=>{addParameterOpen=!addParameterOpen;renderParametersPanel();});
    panel.append(add);
    if(addParameterOpen)panel.append(buildParameterForm());
  }

  function updateParameter(name,changes,row) {
    const error=row.querySelector('.filters-form-error')||element('p','filters-form-error');
    const next=currentParameters.map(parameter=>parameter.name===name?{...parameter,...changes}:parameter);
    try{emitParameters(next);renderParametersPanel();}
    catch(err){error.textContent=err.message;error.hidden=false;if(!error.isConnected)row.append(error);}
  }

  function buildParameterForm() {
    const form=element("div","filter-form parameter-form");form.append(element("strong","","New parameter"));
    const nameLabel=element("label","","Name");const name=element("input","");name.type="text";name.value=`parameter${currentParameters.length+1}`;name.maxLength=64;name.setAttribute("aria-label","New parameter name");nameLabel.append(name);form.append(nameLabel);
    const typeLabel=element("label","","Type");const type=element("select","");type.setAttribute("aria-label","New parameter type");
    for(const [value,text]of [["number","Number"],["text","Text"]]){const option=element("option","",text);option.value=value;type.append(option);}typeLabel.append(type);form.append(typeLabel);
    const valueLabel=element("label","","Value");const value=element("input","");value.type="number";value.value="1";value.step="any";value.setAttribute("aria-label","New parameter value");valueLabel.append(value);form.append(valueLabel);
    const range=element("div","filter-number-range");const min=element("input","");min.type="number";min.step="any";min.placeholder="Minimum";min.setAttribute("aria-label","Parameter minimum");const max=element("input","");max.type="number";max.step="any";max.placeholder="Maximum";max.setAttribute("aria-label","Parameter maximum");range.append(min,max);form.append(range);
    type.addEventListener("change",()=>{const number=type.value==='number';value.type=number?'number':'text';value.value=number?'1':'';valueLabel.firstChild.textContent=number?'Value':'Text value';range.hidden=!number;});
    const error=element("p","filters-form-error");error.hidden=true;form.append(error);
    const actions=element("div","filter-form-actions");const cancel=element("button","filter-cancel","Cancel");cancel.type="button";cancel.addEventListener("click",()=>{addParameterOpen=false;renderParametersPanel();});
    const create=element("button","filter-apply","Create parameter");create.type="button";create.addEventListener("click",()=>{
      const candidate={name:name.value.trim(),type:type.value,value:type.value==='number'?Number(value.value):value.value};
      if(type.value==='number'){
        if(min.value!=='')candidate.min=Number(min.value);
        if(max.value!=='')candidate.max=Number(max.value);
      }
      try{emitParameters([...currentParameters,candidate]);addParameterOpen=false;renderParametersPanel();}
      catch(err){error.textContent=err.message;error.hidden=false;}
    });
    actions.append(cancel,create);form.append(actions);range.hidden=false;return form;
  }

  filtersTab.addEventListener("click",renderFiltersPanel);
  parametersTab.addEventListener("click",renderParametersPanel);
  renderFiltersPanel();
  outsideHandler=e=>{if(popover&&!popover.contains(e.target)&&!anchor?.contains(e.target))closeFiltersPopover();};
  keyHandler=e=>{if(e.key==='Escape')closeFiltersPopover();};
  document.addEventListener("pointerdown",outsideHandler);
  document.addEventListener("keydown",keyHandler);
}
