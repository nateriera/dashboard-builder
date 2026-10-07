import { aggregationOptions, buildCalculatedFieldApplySql, buildCalculatedFieldSql, buildPivotSql, quoteIdentifier } from "../data/wrangling.js";
import { datasetVersion, listDatasets, subscribeDatasetChanges } from "../data/store.js";
import { saveQuery, getQuery } from "../data/queries.js";
import { listWranglingRecipes, removeWranglingRecipe, saveWranglingRecipe } from "../data/wranglingRecipes.js";
import { isUploadRef, uploadId } from "../data/store.js";
import { isQueryRef, queryId, sampleTableName, uploadTableName } from "../data/sql.js";
import { substituteParameters } from "../data/parameters.js";
import { TILE_TYPES, guessMapping } from "../tiles/registry.js";
import { focusDialog } from "./focus.js";
import { anchorPopover } from "./anchoredPopover.js";

let open = null;
export function closeWranglingPopover() {
  if (!open) return;
  open.unsubscribe?.(); open.focus?.(); open.position?.(); open.element.remove(); open = null;
  document.removeEventListener("pointerdown", pointerDown, true); document.removeEventListener("keydown", keyDown);
}
function pointerDown(event) { if (open && !open.element.contains(event.target) && !open.anchor.contains(event.target)) closeWranglingPopover(); }
function keyDown(event) { if (event.key === "Escape") closeWranglingPopover(); }
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
const recipeId = () => `recipe-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}`;

export function toggleWranglingPopover({ anchor, type, meta, dashboard, initialTab = "pivot", getParameters = () => [], onQuery }) {
  if (open?.anchor === anchor) { closeWranglingPopover(); return; }
  closeWranglingPopover();
  const entry = TILE_TYPES[type]; if (!entry) return;
  const mode = initialTab === "formula" ? "formula" : "pivot";
  const pop = el("div", null, "data-popover wrangling-popover"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Data wrangling");
  const head = el("div", null, "data-pop-head"); head.append(el("span", "Data wrangling")); const close = el("button", "×", "data-pop-close"); close.type = "button"; close.setAttribute("aria-label", "Close"); close.addEventListener("click", closeWranglingPopover); head.append(close);
  const tabs = el("div", null, "data-tabs");
  const pivotTab = el("button", "Pivot", "data-tab");
  const formulaTab = el("button", "Calculated field", "data-tab");
  pivotTab.type = formulaTab.type = "button";
  const requestedTab = initialTab === "formula" ? "formula" : "pivot";
  pivotTab.classList.toggle("active", requestedTab === "pivot");
  formulaTab.classList.toggle("active", requestedTab === "formula");
  tabs.append(pivotTab, formulaTab);
  const pivotPanel = el("div", null, "data-panel");
  const formulaPanel = el("div", null, "data-panel");
  pivotPanel.hidden = requestedTab !== "pivot";
  formulaPanel.hidden = requestedTab !== "formula";
  pop.append(head, tabs, pivotPanel, formulaPanel); document.body.appendChild(pop);
  open = { anchor, element: pop };
  open.focus = focusDialog(pop, anchor); open.position = anchorPopover(pop, anchor);
  document.addEventListener("pointerdown", pointerDown, true); document.addEventListener("keydown", keyDown);
  pivotTab.addEventListener("click", () => { pivotTab.classList.add("active"); formulaTab.classList.remove("active"); pivotPanel.hidden = false; formulaPanel.hidden = true; });
  formulaTab.addEventListener("click", () => { formulaTab.classList.add("active"); pivotTab.classList.remove("active"); formulaPanel.hidden = false; pivotPanel.hidden = true; });

  let module;
  let initialising = true;
  const state = { columns: [], types: {}, groups: [], aggs: [], formula: "", name: "", result: null, sql: null, dirty: true, busy: false, error: "" };
  const table = isUploadRef(meta.dataset) ? uploadTableName(uploadId(meta.dataset)) : meta.dataset == null && dashboard?.table ? dashboard.table : sampleTableName(meta.dataset || entry.datasets[0]);
  const query = isQueryRef(meta.dataset) ? getQuery(queryId(meta.dataset)) : null;
  state.table = table; state.sourceDependencies = query?.dependencies ?? (isUploadRef(meta.dataset) ? [`upload:${uploadId(meta.dataset)}`] : null);
  state.sourceSql = query?.sql ? substituteParameters(query.sql.replace(/;\s*$/, ""), structuredClone(getParameters())) : null;
  function render() {
    pivotPanel.replaceChildren(); formulaPanel.replaceChildren();
    if (initialising) {
      const loading = el("p", "Loading DuckDB schema…", "data-sql-note"); loading.setAttribute("role", "status");
      pivotPanel.appendChild(loading);
      formulaPanel.appendChild(loading.cloneNode(true));
      return;
    }
    const groupTitle = el("p", "Group rows and summarize. Results are derived; the source table stays unchanged.", "data-sql-note"); pivotPanel.appendChild(groupTitle);
    renderRecipeControls(pivotPanel,'pivot');
    const list = el("div", null, "wrangle-list");
    state.groups.forEach((group, index) => {
      const row = el("div", null, "wrangle-row");
      const col = columnSelect(`Grouping ${index + 1} column`, group.column);
      col.addEventListener("change", () => { group.column = col.value; invalidate(); });
      const bin = el("select"); bin.setAttribute("aria-label", `Grouping ${index + 1} date interval`);
      for (const [value, label] of [["", "No date bin"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]) { const option = el("option", label); option.value = value; bin.appendChild(option); }
      bin.value = group.bin || ""; bin.disabled = !/DATE|TIME/i.test(state.types[group.column] || "");
      bin.addEventListener("change", () => { group.bin = bin.value || null; invalidate(); });
      row.append(col, bin, moveButton("Move grouping up", index, state.groups), moveButton("Move grouping down", index, state.groups, true), remove("Remove grouping", index, state.groups));
      list.appendChild(row);
    }); pivotPanel.appendChild(list);
    const addGroup = el("button", "Add grouping"); addGroup.type = "button"; addGroup.addEventListener("click", () => { state.groups.push({ column: state.columns.find(name => !state.groups.some(group => group.column === name)) || state.columns[0], bin: null }); render(); }); pivotPanel.appendChild(addGroup);
    const aggs = el("div", null, "wrangle-list");
    state.aggs.forEach((agg, index) => {
      const row = el("div", null, "wrangle-row"); const col = columnSelect(`Aggregation ${index + 1} source column`, agg.column); col.addEventListener("change", () => { agg.column = col.value; agg.operation = aggregationOptions(state.types[col.value])[0]; invalidate(); });
      const op = el("select"); op.setAttribute("aria-label", `Aggregation ${index + 1} operation`); for (const value of aggregationOptions(state.types[agg.column])) { const option = el("option", value === "AVG" ? "Average" : value === "COUNT DISTINCT" ? "Distinct count" : value); option.value = value; op.appendChild(option); } op.value = agg.operation; op.addEventListener("change", () => { agg.operation = op.value; invalidate(); });
      const name = el("input"); name.type = "text"; name.value = agg.name; name.setAttribute("aria-label", `Aggregation ${index + 1} output name`); name.addEventListener("input", () => { agg.name = name.value; invalidate(); });
      row.append(col, op, name, moveButton(`Move aggregation ${index + 1} up`, index, state.aggs), moveButton(`Move aggregation ${index + 1} down`, index, state.aggs, true), remove(`Remove aggregation ${index + 1}`, index, state.aggs)); aggs.appendChild(row);
    }); pivotPanel.appendChild(aggs);
    const addAgg = el("button", "Add aggregation"); addAgg.type = "button"; addAgg.addEventListener("click", () => { const col = state.columns.find(name => aggregationOptions(state.types[name]).includes('SUM')) || state.columns[0]; state.aggs.push({ column: col, operation: aggregationOptions(state.types[col])[0], name: `Result ${state.aggs.length + 1}` }); render(); }); pivotPanel.appendChild(addAgg);
    const runPivot = el("button", "Preview pivot", "data-sql-run"); runPivot.type = "button"; runPivot.disabled = state.busy || (!state.groups.length && !state.aggs.length); runPivot.addEventListener("click", () => execute("pivot")); pivotPanel.appendChild(runPivot); status(pivotPanel); preview(pivotPanel);

    renderRecipeControls(formulaPanel,'formula');
    formulaPanel.append(el("p", "Enter a DuckDB SQL expression such as price * quantity. Click a column name to insert it. Preview validates the expression.", "data-sql-note"));
    const name = el("input"); name.placeholder = "Calculated field name"; name.setAttribute("aria-label", "Calculated field name"); name.value = state.name; name.addEventListener("input", () => { state.name = name.value; invalidate(); }); formulaPanel.appendChild(name);
    const formula = el("textarea"); formula.rows = 3; formula.className = "data-sql-input"; formula.placeholder = '"price" * "quantity"'; formula.setAttribute("aria-label", "Calculated field formula"); formula.value = state.formula; formula.addEventListener("input", () => { state.formula = formula.value; invalidate(); }); formulaPanel.appendChild(formula);
    const insert = el("div", null, "wrangle-column-list"); for (const col of state.columns) { const button = el("button", col); button.type = "button"; button.title = `Insert ${col}`; button.addEventListener("click", () => { const start = formula.selectionStart ?? formula.value.length, end = formula.selectionEnd ?? start; formula.setRangeText(quoteIdentifier(col), start, end, "end"); state.formula = formula.value; invalidate(); }); insert.appendChild(button); } formulaPanel.appendChild(insert);
    const runFormula = el("button", "Preview formula", "data-sql-run"); runFormula.type = "button"; runFormula.disabled = state.busy; runFormula.addEventListener("click", () => execute("formula")); formulaPanel.appendChild(runFormula); status(formulaPanel); preview(formulaPanel);
  };
  function renderRecipeControls(panel,kind) {
    const box=el('div',null,'wrangle-recipes');
    const heading=el('strong','Reusable recipes');box.append(heading);
    const recipes=listWranglingRecipes().filter(recipe=>recipe.kind===kind);
    const select=el('select');select.setAttribute('aria-label',`${kind==='pivot'?'Pivot':'Formula'} recipe`);
    const placeholder=el('option','Choose a saved recipe');placeholder.value='';select.append(placeholder);
    for(const recipe of recipes){const option=el('option',recipe.name);option.value=recipe.id;select.append(option);}
    const load=el('button','Load recipe');load.type='button';load.disabled=!recipes.length;
    const removeRecipe=el('button','Delete recipe');removeRecipe.type='button';removeRecipe.disabled=!recipes.length;
    const name=el('input');name.type='text';name.maxLength=80;name.placeholder='Recipe name';name.setAttribute('aria-label',`${kind==='pivot'?'Pivot':'Formula'} recipe name`);
    const save=el('button','Save recipe');save.type='button';
    const status=el('span','');status.setAttribute('role','status');
    load.addEventListener('click',()=>{
      const recipe=recipes.find(item=>item.id===select.value);if(!recipe)return;
      if(kind==='pivot'){
        const missing=[...recipe.groups.map(group=>group.column),...recipe.aggregations.map(item=>item.column)].filter(column=>!state.columns.includes(column));
        if(missing.length){status.textContent=`This data is missing: ${[...new Set(missing)].join(', ')}.`;return;}
        state.groups=structuredClone(recipe.groups);state.aggs=structuredClone(recipe.aggregations);
      }else{state.formula=recipe.formula;state.name=recipe.outputName;}
      invalidate();render();
    });
    removeRecipe.addEventListener('click',()=>{
      if(!select.value)return;
      try{removeWranglingRecipe(select.value);render();}catch(error){status.textContent=error.message;}
    });
    save.addEventListener('click',()=>{
      try{
        const recipe=kind==='pivot'
          ?{id:recipeId(),name:name.value,kind,groups:state.groups,aggregations:state.aggs}
          :{id:recipeId(),name:name.value,kind,formula:state.formula,outputName:state.name};
        saveWranglingRecipe(recipe);render();
      }catch(error){status.textContent=error.message;}
    });
    box.append(select,load,removeRecipe,name,save,status);panel.append(box);
  }
  function columnSelect(label, selected) { const select = el("select"); select.setAttribute("aria-label", label); for (const name of state.columns) { const option = el("option", `${name} (${state.types[name] || "type unknown"})`); option.value = name; select.appendChild(option); } select.value = selected; return select; }
  function remove(label, index, array) { const button = el("button", "Remove"); button.type = "button"; button.setAttribute("aria-label", label); button.addEventListener("click", () => { array.splice(index, 1); invalidate(); }); return button; }
  function moveButton(label, index, array, down = false) { const button = el("button", down ? "↓" : "↑"); button.type = "button"; button.setAttribute("aria-label", label); button.disabled = down ? index === array.length - 1 : index === 0; button.addEventListener("click", () => { const to = down ? index + 1 : index - 1; [array[index], array[to]] = [array[to], array[index]]; invalidate(); }); return button; }
  function invalidate() {
    state.dirty = true; state.result = null; state.sql = null; state.error = "";
    const statusNodes = [...pivotPanel.querySelectorAll('[role="status"]'), ...formulaPanel.querySelectorAll('[role="status"]')];
    for (const node of statusNodes) node.textContent = "Preview is out of date; run again.";
    for (const button of [...pivotPanel.querySelectorAll('.data-apply'), ...formulaPanel.querySelectorAll('.data-apply')]) button.remove();
  }
  function status(panel) { const status = el("div", state.error || (state.busy ? "Running in DuckDB…" : state.dirty ? "Preview is out of date; run again." : "Derived result; original source unchanged."), state.error ? "data-error" : "data-sql-note"); status.setAttribute("role", state.error ? "alert" : "status"); panel.appendChild(status); }
  function preview(panel) {
    if (!state.result || state.dirty || state.busy) return;
    const wrap = el("div", null, "data-preview-wrap"); const note = el("div", `${state.result.rows.length} preview rows · derived query; source unchanged.`, "data-preview-note"); wrap.appendChild(note);
    const tableEl = el("table", null, "data-preview"); const head = el("tr"); for (const col of state.result.columns) head.appendChild(el("th", col)); const thead = el("thead"); thead.appendChild(head); tableEl.appendChild(thead);
    const body = el("tbody"); for (const row of state.result.rows.slice(0, 5)) { const tr = el("tr"); for (const col of state.result.columns) tr.appendChild(el("td", row[col] == null ? "—" : String(row[col]))); body.appendChild(tr); } tableEl.appendChild(body);
    const mapped = entry.dynamicFields ? {} : guessMapping(entry, state.result.columns);
    const mappingWrap = el("div", null, "data-mapping");
    if (!entry.dynamicFields) {
      const required = entry.fields.filter(field => !field.optional);
      const mapOutput = (key, value) => { if (value) mapped[key] = value; else delete mapped[key]; apply.disabled = required.some(field => !mapped[field.key]); };
      for (const field of entry.fields) {
        const row = el("div", null, "data-field-row"); const label = el("span", field.label, "data-field-label");
        const select = el("select"); select.setAttribute("aria-label", `Output ${field.label}`);
        const none = el("option", field.optional ? "— not mapped —" : "— choose —"); none.value = ""; select.appendChild(none);
        for (const col of state.result.columns) { const option = el("option", col); option.value = col; select.appendChild(option); }
        select.value = mapped[field.key] || "";
        select.addEventListener("change", () => { mapOutput(field.key, select.value); });
        row.append(label, select); mappingWrap.appendChild(row);
      }
      wrap.appendChild(mappingWrap);
    }
    wrap.appendChild(tableEl); panel.appendChild(wrap);
    const apply = el("button", "Apply derived query to tile", "data-apply"); apply.type = "button";
    apply.disabled = entry.fields.some(field => !field.optional && !mapped[field.key]);
    apply.addEventListener("click", () => applyResult(mapped)); panel.appendChild(apply);
  }
  async function execute(kind) {
    if (state.busy) return; state.busy = true; state.error = ""; render();
    try {
      const run = await executeForConfiguration(kind, state.groups, state.aggs, state.formula, state.name, state.columns, state.types, state.table, state.sourceSql, module, getParameters);
      const sql = kind === "pivot" ? buildPivotSql({ table: state.table, sourceSql: state.sourceSql, groups: state.groups, aggregations: state.aggs, types: state.types }) : buildCalculatedFieldApplySql({ table: state.table, sourceSql: state.sourceSql, formula: state.formula, name: state.name });
      if (!pop.isConnected || datasetVersion() !== run.revision) throw new Error("Data changed while previewing. Run again.");
      state.result = run; state.sql = sql; state.dirty = false;
    } catch (error) {
      const message = error?.message || String(error);
      state.error = kind === "formula" ? `Formula could not be evaluated; check the expression and referenced columns. ${message}` : message;
      state.result = null; state.dirty = true;
    }
    finally { state.busy = false; if (pop.isConnected) render(); }
  }
  async function executeForConfiguration(kind, groups, aggregations, formula, name, columns, types, table, sourceSql, duckdb, getParameters) {
    const args = { table, sourceSql };
    const sql = kind === "pivot" ? buildPivotSql({ ...args, groups, aggregations, types }) : buildCalculatedFieldSql({ ...args, formula, name, columns });
    return duckdb.runQueryDetailed(substituteParameters(sql, structuredClone(getParameters())));
  }
  function applyResult(mapping) {
    if (state.dirty || !state.result || !state.sql || entry.fields.some(field => !field.optional && !mapping[field.key])) return;
    const saved = saveQuery({ sql: state.sql, dependencies: state.sourceDependencies, columns: state.result.columns, fieldKeys: entry.dynamicFields ? [...state.result.columns] : entry.fields.map(field => field.key), mapping });
    onQuery?.(saved); closeWranglingPopover();
  }
  open.unsubscribe = subscribeDatasetChanges(() => invalidate());
  void (async () => {
    try {
      module = await import("../data/duckdb.js"); await module.ensureTables(); if (!pop.isConnected) return;
      const query = isQueryRef(meta.dataset) ? getQuery(queryId(meta.dataset)) : null;
      state.sourceSql = query?.sql ? substituteParameters(query.sql, structuredClone(getParameters())) : null; state.table = query ? null : table;
      state.sourceDependencies = query?.dependencies ?? (isUploadRef(meta.dataset) ? [`upload:${uploadId(meta.dataset)}`] : null);
      const schemaSql = state.sourceSql ? `SELECT * FROM (${state.sourceSql}) AS wrangle_source LIMIT 0` : `SELECT * FROM ${quoteIdentifier(table)} LIMIT 0`;
      const schema = await module.runQueryDetailed(schemaSql); state.columns = schema.columns; state.types = schema.types;
      if (state.columns.length) {
        state.groups = [{ column: state.columns[0], bin: null }];
        const numeric = state.columns.find(name => aggregationOptions(state.types[name]).includes('SUM'));
        if (numeric) state.aggs = [{ column: numeric, operation: 'SUM', name: `Sum of ${numeric}` }];
      }
      initialising = false;
      render();
    } catch (error) {
      initialising = false;
      state.error = error?.message || String(error);
      render();
    }
  })();
}
