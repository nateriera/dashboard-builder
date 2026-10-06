import { anchorPopover } from "./anchoredPopover.js";
import { validateFilters } from "../data/filters.js";
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

function openFiltersPopover({ anchor: nextAnchor, filters, parameters, fields, tileTitle, onFiltersChange, onParametersChange }) {
  anchor=nextAnchor;
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
    const note=element("p","filters-help","Tiles without a filter field are left unchanged. Date fields are excluded in this phase.");
    panel.append(note);
    const list=element("div","dashboard-filter-list");
    for(const filter of currentFilters){
      const chip=element("div",filter.source==='crossfilter'?'dashboard-filter-chip crossfilter-chip':'dashboard-filter-chip');
      if(filter.source==='crossfilter') chip.setAttribute("data-crossfilter-chip","true");
      const caption=element("span","",filterDescription(filter));
      const remove=element("button","filter-remove","×");remove.type="button";remove.title=`Remove ${filter.field} filter`;remove.setAttribute("aria-label",`Remove ${filter.field} filter`);
      remove.addEventListener("click",()=>{emitFilters(currentFilters.filter(item=>item.id!==filter.id));renderFiltersPanel();});
      chip.append(caption,remove);list.append(chip);
    }
    panel.append(list);
    const add=element("button","filter-add","Add filter");add.type="button";add.addEventListener("click",()=>{addFilterOpen=!addFilterOpen;renderFiltersPanel();});
    panel.append(add);
    if(addFilterOpen) panel.append(buildFilterForm());
  }

  function buildFilterForm() {
    const form=element("div","filter-form");
    const legend=element("strong","","New filter");form.append(legend);
    const fieldLabel=element("label","filter-field-label","Field");
    const fieldSelect=element("select","filter-field-select");fieldSelect.setAttribute("aria-label","Filter field");
    const placeholder=element("option","","Choose a field");placeholder.value="";placeholder.disabled=true;placeholder.selected=true;fieldSelect.append(placeholder);
    for(const option of fields){const item=element("option","",`${option.field} · ${option.type==='number'?'Number':'Category'}`);item.value=option.field;fieldSelect.append(item);}
    fieldLabel.append(fieldSelect);form.append(fieldLabel);
    const controls=element("div","filter-value-controls");form.append(controls);
    const error=element("p","filters-form-error");error.hidden=true;form.append(error);
    const actions=element("div","filter-form-actions");
    const cancel=element("button","filter-cancel","Cancel");cancel.type="button";cancel.addEventListener("click",()=>{addFilterOpen=false;renderFiltersPanel();});
    const apply=element("button","filter-apply","Apply filter");apply.type="button";apply.disabled=true;
    actions.append(cancel,apply);form.append(actions);
    let selectedField=null,selectedOperator="is",selectedValues=[];

    const showError=message=>{error.textContent=message;error.hidden=!message;};
    const renderControls=()=>{
      controls.replaceChildren();
      selectedField=fields.find(option=>option.field===fieldSelect.value)||null;
      selectedValues=[];apply.disabled=true;
      if(!selectedField)return;
      if(selectedField.type==='number'){
        const range=element("div","filter-number-range");
        const min=element("input","filter-min");min.type="number";min.step="any";min.placeholder="Minimum";min.setAttribute("aria-label","Minimum");
        const max=element("input","filter-max");max.type="number";max.step="any";max.placeholder="Maximum";max.setAttribute("aria-label","Maximum");
        range.append(min,max);controls.append(range);
        const update=()=>{selectedValues=[min.value,max.value];apply.disabled=min.value===''||max.value===''||!Number.isFinite(Number(min.value))||!Number.isFinite(Number(max.value))||Number(min.value)>Number(max.value);};
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
            selectedValues=[...next].map(i=>selectedField.values[i]);apply.disabled=selectedValues.length===0;
          });
          label.append(checkbox,document.createTextNode(value===null?'Blank':String(value)));values.append(label);
        }
        controls.append(values);
        if(selectedField.truncated)controls.append(element("p","filters-overflow","200+ values — narrow with another filter before selecting."));
        if(!selectedField.values.length)controls.append(element("p","filters-help","This field has no filterable values."));
      }
    };
    fieldSelect.addEventListener("change",renderControls);
    apply.addEventListener("click",()=>{
      if(!selectedField)return;
      let filter;
      if(selectedField.type==='number'){
        const [min,max]=selectedValues.map(Number);
        if(!Number.isFinite(min)||!Number.isFinite(max)||min>max){showError("Enter a valid minimum and maximum.");return;}
        filter={id:newId('filter'),field:selectedField.field,op:'between',values:[min,max]};
      }else filter={id:newId('filter'),field:selectedField.field,op:selectedOperator,values:selectedValues};
      try{emitFilters([...currentFilters,filter]);addFilterOpen=false;renderFiltersPanel();}
      catch(err){showError(err.message);}
    });
    return form;
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
