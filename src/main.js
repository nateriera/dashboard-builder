import { validateLayout, assertNoCollisions } from "./data/layout.js";
import { validateFilters, applyFilters, distinctValues, filterFieldType, sortAndLimitRows } from "./data/filters.js";
import { validateParameters, substituteParameters } from "./data/parameters.js";
import { datasetVersion, listDatasets, storageIssues, rollbackDatasets, subscribeDatasetChanges } from "./data/store.js";
import { querySnapshot, rollbackQueries, serializeQueries } from "./data/queries.js";
import { LIMITS } from "./data/limits.js";
// Dashboard Builder — MVP composer (Shape A: standalone vanilla app).
//
// A drag-and-drop dashboard composer: the left palette lists chart types from
// the tile registry; tiles live on a 12-column GridStack grid and render
// theme-aware chart components at their tile width. Layouts persist as JSON
// (localStorage autosave + explicit export/import).

import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import "./style.css";
import { chartStyles } from "./charts/charts.js";
import { getTheme, getThemeId, setTheme, THEMES } from "./themes/themes.js";
import { TILE_TYPES, DATASETS, DATASET_LABELS, resizeTileChart } from "./tiles/registry.js";
import { ROW_HEIGHT } from "./tiles/geometry.js";
import { fitTileToContent } from "./tiles/autofit.js";
import { guessMapping, normalizeRows } from "./tiles/normalize.js";
import {
  isUploadRef,
  uploadId,
  getDataset,
  hasDataset,
  loadPersistedDatasets,
  inlineDatasets,
  restoreDatasets,
  saveDataset,
  persistDataset
} from "./data/store.js";
import {
  isQueryRef,
  queryId,
  getQuery,
  hasQuery,
  loadPersistedQueries,
  inlineQueries,
  restoreQueries,
  pruneQueries
} from "./data/queries.js";
import { isMissingTableError, sampleTableName, uploadTableName } from "./data/sql.js";
import { toggleDataPopover, closeDataPopover } from "./ui/dataPopover.js";
import { toggleDashboardPopover, closeDashboardPopover } from "./ui/dashboardDataPopover.js";
import { toggleThemePopover, closeThemePopover } from "./ui/themePopover.js";
import { openTemplateGallery } from "./ui/templateGallery.js";
import { openGuidedStart } from "./ui/guidedStart.js";
import { resolveTileTitle } from "./tiles/titles.js";
import { toggleFiltersPopover } from "./ui/filtersPopover.js";
import { chartData } from "./ui/chartData.js";

// The chart kit's component CSS (cards, headers, KPIs, legends), injected
// once. It styles itself through theme CSS variables (see src/themes/).
document.head.appendChild(chartStyles);

// Apply the persisted theme before anything renders.
setTheme(getThemeId());

const STORAGE_KEY = "dashboard-builder:layout:v1";
const FIRST_RUN_HINT_KEY = "dashbuilder.seenHint.v1";
// Build stamp, shown in the status bar on boot. Bump on every shipped archive
// so it's always possible to confirm which code is actually running.
const BUILD = "2f-pages-fit";
const gridEl = document.querySelector(".grid-stack");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Grid ─────────────────────────────────────────────────────────────────
const grid = GridStack.init(
  {
    column: 12,
    cellHeight: ROW_HEIGHT,
    animate: false,
    margin: 12,
    // Drag tiles by their toolbar so chart tooltips/legends stay clickable.
    draggable: { handle: ".tile-toolbar" },
    alwaysShowResizeHandle: true,
    resizable: { handles: "all" }
  },
  gridEl
);

// ── Tile metadata ────────────────────────────────────────────────────────
// GridStack owns geometry (x/y/w/h); this map owns everything else per tile.
let tileSeq = 0;
const tileMeta = new Map(); // widget id -> {id, type, title, source, dataset, tileOptions}
// A tile's `dataset` is null when it follows the dashboard-wide default below;
// any explicit sample key / "upload:<id>" / "query:<id>" is a per-tile override.

// ── Dashboard-wide default dataset ───────────────────────────────────────
// {kind:"samples"} = each tile type's own sample data (the classic behavior),
// {kind:"dataset", ref} = one sample key or "upload:<id>" for every following tile.
let dashboardDefault = { kind: "samples" };
let filters = [];
let parameters = [];

function dashboardDefaultName() {
  const dd = dashboardDefault;
  if (!dd || dd.kind === "samples") return "Tile samples";
  if (isUploadRef(dd.ref)) {
    const ds = getDataset(uploadId(dd.ref));
    return ds ? ds.name + (ds.persisted ? "" : " (session only)") : "Missing upload";
  }
  return DATASET_LABELS[dd.ref] || dd.ref;
}

/** SQL table name for the dashboard default, or null when it has none. */
function dashboardTableName() {
  const dd = dashboardDefault;
  if (!dd || dd.kind !== "dataset") return null;
  if (isUploadRef(dd.ref)) return uploadTableName(uploadId(dd.ref));
  return sampleTableName(dd.ref);
}

function validateDashboardDefault(dd) {
  if (!dd || dd.kind === "samples") return { kind: "samples" };
  if (dd.kind === "dataset" && typeof dd.ref === "string") {
    if (DATASETS[dd.ref]) return { kind: "dataset", ref: dd.ref };
    if (isUploadRef(dd.ref)) {
      return { kind: "dataset", ref: dd.ref };
    }
  }
  return { kind: "samples" };
}

/** Resolve the dashboard default to render-ready rows for a tile type.
 *  Uploads are normalized per tile type from their original columns
 *  (auto-guessed mapping); returns null when missing or unmappable. */
function resolveDashboardRows(entry) {
  const dd = dashboardDefault;
  if (!dd || dd.kind === "samples") return DATASETS[entry.defaultDataset] || null;
  const ref = dd.ref;
  if (!isUploadRef(ref)) return DATASETS[ref] || null;
  const ds = getDataset(uploadId(ref));
  if (!ds) return null;
  const raw = ds.raw || { columns: ds.columns, rows: ds.rows };
  const mapping = guessMapping(entry, raw.columns);
  const required = entry.fields.filter((f) => !f.optional);
  if (!required.every((f) => mapping[f.key])) return null; // can't map: caller shows a notice
  return mergeSourceColumns(normalizeRows(entry, raw.rows, mapping).rows, raw.rows);
}

function mergeSourceColumns(normalized, sourceRows) {
  if (!Array.isArray(sourceRows) || sourceRows.length !== normalized.length) return normalized;
  return normalized.map((row, index) => ({ ...sourceRows[index], ...row }));
}

function resolveUploadRows(dataset) {
  const sourceRows = dataset.raw?.rows;
  return mergeSourceColumns(dataset.rows, sourceRows);
}

// Resolve a tile's render-ready (normalized) rows for static export.
// Mirrors renderTile/renderQueryTile's data logic; returns {rows} or {error}
// without touching the DOM or mutating tile metadata.
async function resolveExportRows(meta, entry) {
  const withRawRows = rows => ({ ...prepareTileRows(meta, rows), rawRows: rows });
  if (entry.noData) return { rows: [] };
  if (isQueryRef(meta.dataset)) {
    const qid = queryId(meta.dataset);
    const q = getQuery(qid);
    if (!q) return { error: "Saved query is missing." };
    try {
      const { getCachedRows, runTileQuery } = await import("./data/duckdb.js");
      const rows = getCachedRows(qid, q, entry, parameters) || (await runTileQuery(qid, q, entry, parameters));
      return withRawRows(rows);
    } catch (err) {
      return { error: `Query failed: ${err && err.message ? err.message : err}` };
    }
  }
  if (meta.dataset == null) {
    const rows = resolveDashboardRows(entry);
    return rows
      ? withRawRows(rows)
      : { error: `Dashboard data (“${dashboardDefaultName()}”) can't be used for this chart type.` };
  }
  if (isUploadRef(meta.dataset)) {
    const ds = getDataset(uploadId(meta.dataset));
    return ds ? withRawRows(resolveUploadRows(ds)) : { error: "Uploaded dataset is missing." };
  }
  const rows = DATASETS[meta.dataset];
  return rows ? withRawRows(rows) : { error: "Sample dataset is missing." };
}

// ── Tile DOM ─────────────────────────────────────────────────────────────
function buildTileContent(type, meta) {
  const entry = TILE_TYPES[type];

  const tile = document.createElement("div");
  tile.className = "tile";

  const toolbar = document.createElement("div");
  toolbar.className = "tile-toolbar";

  const titleInput = document.createElement("input");
  titleInput.className = "tile-title";
  titleInput.hidden = !!entry.noData;
  titleInput.value = meta.title;
  titleInput.title = meta.title;
  titleInput.spellcheck = false;
  titleInput.setAttribute("aria-label", "Tile title");
  // 'change' (not 'input') so re-rendering the chart below doesn't steal focus.
  titleInput.addEventListener("change", () => {
    meta.title = titleInput.value;
    titleInput.title = meta.title;
    renderTileById(meta.id);
    scheduleAutosave();
  });

  // ── Data button: opens the Samples/Upload popover ──
  const dataBtn = document.createElement("button");
  dataBtn.type = "button";
  dataBtn.className = "tile-data-btn";
  dataBtn.hidden = !!entry.noData;
  dataBtn.title = "Choose or upload data";
  const dataLabel = document.createElement("span");
  dataLabel.className = "tile-data-label";
  dataBtn.append(document.createTextNode("Data: "), dataLabel);
  const refreshDataLabel = () => {
    dataLabel.textContent = datasetDisplayName(meta);
  };
  dataBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDataPopover({
      anchor: dataBtn,
      type,
      meta,
      dashboard: { name: dashboardDefaultName(), table: dashboardTableName() },
      getParameters: () => parameters,
      onDashboard: () => {
        meta.dataset = null;
        meta.source = "Dashboard default";
        refreshDataLabel();
        renderTileById(meta.id);
        scheduleAutosave();
      },
      onSample: (key) => {
        meta.dataset = key;
        meta.source = "Sample data";
        refreshDataLabel();
        renderTileById(meta.id);
        scheduleAutosave();
      },
      onUpload: ({ id, name, persisted }) => {
        meta.dataset = `upload:${id}`;
        meta.source = name;
        refreshDataLabel();
        renderTileById(meta.id);
        scheduleAutosave();
        setStatus(
          persisted
            ? `Loaded ${name}`
            : `Loaded ${name} — browser storage unavailable, kept for this session only.`
        );

      },
      onQuery: ({ id, name, persisted }) => {
        meta.dataset = `query:${id}`;
        meta.source = name;
        pruneQueries([...tileMeta.values()].map((m) => m.dataset));
        refreshDataLabel();
        renderTileById(meta.id);
        scheduleAutosave();
        setStatus(`SQL query applied — ${name}` + (persisted ? "" : " — session only; export JSON for backup."));
      }
    });
  });
  refreshDataLabel();

  const removeBtn = document.createElement("button");
  removeBtn.className = "tile-remove";
  removeBtn.type = "button";
  removeBtn.textContent = "×";
  removeBtn.title = "Remove tile";
  removeBtn.setAttribute("aria-label", "Remove tile");
  removeBtn.addEventListener("click", () => {
    const widgetEl = tile.closest(".grid-stack-item");
    if (widgetEl) grid.removeWidget(widgetEl);
    document.querySelector(".palette-item")?.focus();
  });

  toolbar.append(titleInput, dataBtn);
  const settings = document.createElement('details'); settings.className = 'tile-settings';
  const summary = document.createElement('summary'); summary.textContent = 'Settings'; settings.append(summary);
  const settingsBody = document.createElement('div'); settingsBody.className = 'tile-settings-body'; settings.append(settingsBody);
  settings.addEventListener('pointerdown', e => e.stopPropagation());
  settings.addEventListener('mousedown', e => e.stopPropagation());
  const fitButton = document.createElement('button'); fitButton.type = 'button'; fitButton.textContent = 'Fit content';
  fitButton.addEventListener('click', () => { meta.sizing = 'auto'; renderTileById(meta.id); scheduleAutosave(); });
  settingsBody.append(fitButton);

  const chartTypeLabel = document.createElement('label'); chartTypeLabel.className = 'tile-control'; chartTypeLabel.textContent = 'Chart type';
  chartTypeLabel.hidden = !!entry.noData;
  const chartTypeSelect = document.createElement('select'); chartTypeSelect.setAttribute('aria-label', 'Chart type');
  const populateChartTypes = (selected = meta.type) => {
    const compatible = compatibleChartTypes(meta);
    chartTypeSelect.replaceChildren();
    for (const type of compatible) {
      const option = document.createElement('option'); option.value = type; option.textContent = TILE_TYPES[type].label; chartTypeSelect.append(option);
    }
    chartTypeSelect.value = compatible.includes(selected) ? selected : meta.type;
  };
  populateChartTypes();
  chartTypeSelect.addEventListener('focus', () => populateChartTypes(chartTypeSelect.value));
  chartTypeSelect.addEventListener('change', () => {
    const nextType = chartTypeSelect.value;
    if (!compatibleChartTypes(meta).includes(nextType)) { chartTypeSelect.value = meta.type; return; }
    const widget = tile.closest('.grid-stack-item');
    const host = widget?.querySelector('.grid-stack-item-content');
    if (!widget || !host) return;
    meta.type = nextType;
    meta.tileOptions = {};
    host.replaceChildren(buildTileContent(nextType, meta));
    renderTile(widget);
    scheduleAutosave();
  });
  chartTypeLabel.append(chartTypeSelect); settingsBody.append(chartTypeLabel);

  // Per-type extra controls declared by the registry (e.g. scatter trend toggle).
  for (const ctrl of entry.controls || []) {
    if (ctrl.type === "checkbox") {
      const label = document.createElement("label");
      label.className = "tile-control";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = meta.tileOptions[ctrl.key] ?? ctrl.default ?? false;
      box.addEventListener("change", () => {
        meta.tileOptions[ctrl.key] = box.checked;
        renderTileById(meta.id);
        scheduleAutosave();
      });
      label.append(box, document.createTextNode(ctrl.label));
      settingsBody.append(label);
    } else if (ctrl.type === "select") {
      const label=document.createElement('label');label.className='tile-control';label.textContent=ctrl.label;
      const select=document.createElement('select');select.setAttribute('aria-label',ctrl.label);
      for(const [value,caption] of ctrl.options){const option=document.createElement('option');option.value=value;option.textContent=caption;select.append(option);}
      select.value=meta.tileOptions[ctrl.key]??ctrl.default;
      select.addEventListener('change',()=>{meta.tileOptions[ctrl.key]=select.value;renderTileById(meta.id);scheduleAutosave();});
      label.append(select);settingsBody.append(label);
    } else if (ctrl.type === "number") {
      const label=document.createElement('label');label.className='tile-control';label.textContent=ctrl.label;
      const input=document.createElement('input');input.type='number';
      if (ctrl.min !== undefined) input.min=String(ctrl.min);
      if (ctrl.max !== undefined) input.max=String(ctrl.max);
      input.step=String(ctrl.step??1);input.value=String(meta.tileOptions[ctrl.key]??ctrl.default??'');input.setAttribute('aria-label',ctrl.label);
      input.addEventListener('change',()=>{
        if (ctrl.allowEmpty && input.value === '') delete meta.tileOptions[ctrl.key];
        else {
          const raw=Number(input.value);
          if (!Number.isFinite(raw)) { input.value=String(meta.tileOptions[ctrl.key]??ctrl.default??''); return; }
          const step=ctrl.step === 'any' ? null : Number(ctrl.step||1);
          const rounded=step ? Math.round(raw/step)*step : raw;
          const min=ctrl.min??-Infinity,max=ctrl.max??Infinity;
          meta.tileOptions[ctrl.key]=Math.min(max,Math.max(min,rounded));
        }
        input.value=String(meta.tileOptions[ctrl.key]??'');
        renderTileById(meta.id);scheduleAutosave();
      });
      label.append(input);settingsBody.append(label);
    } else if (ctrl.type === "textarea") {
      const label=document.createElement('label');label.className='tile-control tile-control-textarea';label.textContent=ctrl.label;
      const input=document.createElement('textarea');input.rows=ctrl.rows||4;input.maxLength=ctrl.maxLength||10000;input.value=meta.tileOptions[ctrl.key]??ctrl.default??'';input.setAttribute('aria-label',ctrl.label);
      input.addEventListener('input',()=>{meta.tileOptions[ctrl.key]=input.value;renderTileById(meta.id);scheduleAutosave();});
      label.append(input);settingsBody.append(label);
    }
  }
  if(entry.crossfilterField){
    const label=document.createElement('label');label.className='tile-control';label.textContent='Incoming cross-filter behavior';
    const select=document.createElement('select');select.setAttribute('aria-label','Incoming cross-filter behavior');
    for(const [value,caption] of [['filter','Filter rows'],['highlight','Highlight marks'],['none','Ignore selections']]){const option=document.createElement('option');option.value=value;option.textContent=caption;select.append(option);}
    select.value=meta.tileOptions.crossfilterMode||'filter';
    select.addEventListener('change',()=>{meta.tileOptions.crossfilterMode=select.value;renderTileById(meta.id);scheduleAutosave();});
    label.append(select);settingsBody.append(label);
    const actionLabel=document.createElement('label');actionLabel.className='tile-control';actionLabel.textContent='Mark click action';
    const action=document.createElement('select');action.setAttribute('aria-label','Mark click action');
    for(const [value,caption] of [['filter-and-inspect','Filter charts and inspect records'],['filter-only','Filter charts'],['inspect-only','Inspect records']]){const option=document.createElement('option');option.value=value;option.textContent=caption;action.append(option);}
    action.value=meta.tileOptions.clickAction||'filter-and-inspect';
    action.addEventListener('change',()=>{meta.tileOptions.clickAction=action.value;meta.drillValues=null;renderTileById(meta.id);scheduleAutosave();});
    actionLabel.append(action);settingsBody.append(actionLabel);
  }
  if (entry.fields.some(f => f.numeric)) {
    for (const key of ['xLabel','yLabel']) {
      const label = document.createElement('label'); label.className = 'tile-control';
      label.textContent = key === 'xLabel' ? 'X label / unit ' : 'Y label / unit ';
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 120;
      input.setAttribute('aria-label',label.textContent.trim()); input.value = meta.tileOptions[key] || '';
      input.addEventListener('change', () => { meta.tileOptions[key] = input.value; renderTileById(meta.id); scheduleAutosave(); });
      label.append(input); settingsBody.append(label);
    }
  }
  toolbar.append(settings);
  toolbar.append(removeBtn);

  const chart = document.createElement("div");
  chart.className = "tile-chart";

  tile.append(toolbar, chart);
  return tile;
}

// Add a tile of `type` to the grid. Omit x/y for auto-placement.
function addTile(type, { id, x, y, w, h, title, source, dataset, tileOptions, sizing = "manual", fit = false } = {}) {
  const entry = TILE_TYPES[type];
  if (!entry) return null;

  const widgetId = id || `tile-${Date.now().toString(36)}-${tileSeq++}`;
  const meta = {
    id: widgetId,
    type,
    title: resolveTileTitle(title, entry.defaultTitle, [...tileMeta.values()].map((tile) => tile.title)),
    source: source ?? "Sample data",
    // New tiles follow the dashboard-wide default (null); explicit refs are
    // per-tile overrides. Undefined (very old layouts) also follows.
    dataset: dataset === undefined ? null : dataset,
    sizing: fit ? "auto" : sizing,
    tileOptions: { ...(tileOptions || {}) }
  };
  tileMeta.set(widgetId, meta);

  const el = grid.addWidget({
    x,
    y,
    w: w ?? entry.defaultSize.w,
    h: h ?? entry.defaultSize.h,
    id: widgetId // stored as the gs-id attribute; used to rejoin geometry + metadata
  });

  let host = el.querySelector(".grid-stack-item-content");
  if (!host) {
    host = document.createElement("div");
    host.className = "grid-stack-item-content";
    el.appendChild(host);
  }
  host.appendChild(buildTileContent(type, meta));

  // Measure after layout so the chart renders at the tile's real width,
  // then frame the tile's rows to the rendered content.
  requestAnimationFrame(() => {
    renderTile(el);
    fitTileNow(el);
  });
  return el;
}

// Resolve a tile's data: bundled sample, previously-uploaded dataset, or the
// dashboard-wide default when the tile follows it (meta.dataset == null).
function resolveTileData(meta, entry) {
  if (meta.dataset == null) return resolveDashboardRows(entry);
  if (isUploadRef(meta.dataset)) {
    const ds = getDataset(uploadId(meta.dataset));
    return ds ? resolveUploadRows(ds) : null;
  }
  return DATASETS[meta.dataset] || null;
}

function filtersForTile(meta) {
  const mode=meta.tileOptions?.crossfilterMode||'filter';
  return filters.filter(filter=>filter.source!=='crossfilter'||filter.sourceTile===meta.id||mode==='filter');
}

function prepareTileRows(meta, rows) {
  const filtered = applyFilters(rows, filtersForTile(meta), { sourceTile: meta.id });
  if (filtered.applied && filtered.rows.length === 0) return { rows: [], empty: true, filtered: true };
  const sortable = ['bar','column','dot','stackedBar','stackedColumn'].includes(meta.type);
  const topN = sortable ? meta.tileOptions?.topN ?? null : null;
  const prepared = topN !== null
    ? sortAndLimitRows(meta.type, filtered.rows, { sort: meta.tileOptions?.sort ?? 'desc', topN })
    : filtered.rows;
  return { rows: prepared, empty: false, filtered: filtered.applied };
}

function datasetDisplayName(meta) {
  if (meta.dataset == null) return `Dashboard: ${dashboardDefaultName()}`;
  if (isUploadRef(meta.dataset)) {
    const ds = getDataset(uploadId(meta.dataset));
    return ds ? ds.name : "Missing upload";
  }
  if (isQueryRef(meta.dataset)) {
    const q = getQuery(queryId(meta.dataset));
    return q ? q.name : "Missing query";
  }
  return DATASET_LABELS[meta.dataset] || meta.dataset;
}

function paintUnavailable(el, title, message) {
  el.replaceChildren();
  const box = document.createElement("div"); box.className = "tile-error"; box.setAttribute("role","alert");
  const head = document.createElement("strong"); head.textContent = title;
  const msg = document.createElement("p"); msg.textContent = message;
  const repair = document.createElement("button"); repair.type = "button"; repair.textContent = "Repair data binding";
  repair.onclick = () => el.closest(".tile")?.querySelector(".tile-data-btn")?.click();
  box.append(head,msg,repair); el.append(box);
}

function compatibleChartTypes(meta) {
  const rows = meta.filterRows || resolveTileData(meta, TILE_TYPES[meta.type]);
  if (!Array.isArray(rows) || !rows.length) return [meta.type];
  return Object.entries(TILE_TYPES).filter(([, entry]) => {
    if (entry.noData || !entry.fields?.length) return false;
    return entry.fields.filter(field => !field.optional).every(field => rows.some(row => {
      if (!Object.hasOwn(row, field.key)) return false;
      const value = row[field.key];
      return !field.numeric || typeof value === 'number' && Number.isFinite(value);
    }));
  }).map(([type]) => type);
}

function paintFilteredEmpty(el) {
  el.replaceChildren();
  const box=document.createElement('div');box.className='tile-empty';box.setAttribute('role','status');
  box.textContent='No rows match the active filters.';
  el.append(box);
}

function crossfilterValuesFromTarget(target) {
  const dataMark=target.closest?.('[data-crossfilter-values]');
  const encoded=dataMark?.getAttribute('data-crossfilter-values');
  if (encoded) {
    try { const values=JSON.parse(decodeURIComponent(encoded)); return Array.isArray(values) ? values : [values]; } catch { return null; }
  }
  const link=target.closest?.('a');
  const href=link?.getAttributeNS?.('http://www.w3.org/1999/xlink','href') || link?.getAttribute?.('href') || '';
  const prefix='#db-crossfilter:';
  if (!href.startsWith(prefix)) return null;
  try { const values=JSON.parse(decodeURIComponent(href.slice(prefix.length))); return Array.isArray(values) ? values : [values]; } catch { return null; }
}

const timeBrushStates=new WeakMap();
function brushPoints(svg,state){
  const rows=state.meta.renderRows||state.meta.filterRows||[];
  const circles=[...svg.querySelectorAll('g[aria-label="dot"] circle')].slice(0,rows.length);
  return circles.flatMap((circle,index)=>{
    const x=Number(circle.getAttribute('cx')),date=new Date(rows[index]?.date);
    return Number.isFinite(x)&&Number.isFinite(date.getTime())?[{x,time:date.getTime()}]:[];
  }).sort((a,b)=>a.x-b.x).filter((point,index,all)=>index===0||point.x!==all[index-1].x);
}
function dateAtBrushX(points,x){
  if(!points.length)return null;
  if(x<=points[0].x)return points[0].time;
  if(x>=points.at(-1).x)return points.at(-1).time;
  const right=points.findIndex(point=>point.x>=x),a=points[right-1],b=points[right];
  return a.time+(b.time-a.time)*(x-a.x)/(b.x-a.x);
}
function brushXAtDate(points,time){
  if(!points.length)return null;
  const byTime=[...points].sort((a,b)=>a.time-b.time);
  if(time<=byTime[0].time)return byTime[0].x;
  if(time>=byTime.at(-1).time)return byTime.at(-1).x;
  const right=byTime.findIndex(point=>point.time>=time),a=byTime[right-1],b=byTime[right];
  return a.x+(b.x-a.x)*(time-a.time)/(b.time-a.time);
}
function wireTimeBrush(chartEl,meta,entry){
  const field=entry.fields?.find(item=>item.key==='date')?.key;
  if(!field||!['line','area'].includes(meta.type))return;
  let state=timeBrushStates.get(chartEl);
  if(!state){
    state={meta,entry,drag:null};timeBrushStates.set(chartEl,state);
    const plotX=(svg,clientX)=>{const bounds=svg.getBoundingClientRect(),view=svg.viewBox.baseVal;return view.x+(clientX-bounds.left)*view.width/bounds.width;};
    const rectangle=(svg)=>{let rect=svg.querySelector(':scope > rect.db-time-brush');if(!rect){rect=document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('class','db-time-brush');rect.setAttribute('aria-hidden','true');svg.append(rect);}return rect;};
    const draw=(svg,x1,x2,points)=>{const view=svg.viewBox.baseVal,left=Math.max(points[0].x,Math.min(x1,x2)),right=Math.min(points.at(-1).x,Math.max(x1,x2)),rect=rectangle(svg);rect.setAttribute('x',String(left));rect.setAttribute('y',String(view.y));rect.setAttribute('width',String(Math.max(0,right-left)));rect.setAttribute('height',String(view.height));};
    chartEl.addEventListener('pointerdown',event=>{
      const svg=event.target.closest?.('svg[role="img"]');if(event.button!==0||!svg)return;
      const points=brushPoints(svg,state);if(points.length<2)return;
      const x=plotX(svg,event.clientX);if(x<points[0].x||x>points.at(-1).x)return;
      state.drag={svg,points,startX:x,currentX:x,pointerId:event.pointerId};svg.setPointerCapture?.(event.pointerId);draw(svg,x,x,points);event.preventDefault();
    },true);
    chartEl.addEventListener('pointermove',event=>{const drag=state.drag;if(!drag||drag.pointerId!==event.pointerId)return;drag.currentX=plotX(drag.svg,event.clientX);draw(drag.svg,drag.startX,drag.currentX,drag.points);},true);
    chartEl.addEventListener('pointerup',event=>{
      const drag=state.drag;if(!drag||drag.pointerId!==event.pointerId)return;state.drag=null;
      if(Math.abs(drag.currentX-drag.startX)<12){drag.svg.querySelector(':scope > rect.db-time-brush')?.remove();return;}
      const a=dateAtBrushX(drag.points,Math.min(drag.startX,drag.currentX)),b=dateAtBrushX(drag.points,Math.max(drag.startX,drag.currentX));
      if(!Number.isFinite(a)||!Number.isFinite(b))return;
      const values=[new Date(a).toISOString().slice(0,10),new Date(b).toISOString().slice(0,10)];
      const {meta,entry}=state,current=filters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===meta.id&&filter.field===field&&filter.op==='date-between');
      setFilters([...filters.filter(filter=>filter!==current),{id:current?.id||`cross-date-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,field:entry.fields.find(item=>item.key==='date').key,op:'date-between',values,source:'crossfilter',sourceTile:meta.id}]);
    },true);
    chartEl.addEventListener('pointercancel',event=>{if(state.drag?.pointerId===event.pointerId){state.drag.svg.querySelector(':scope > rect.db-time-brush')?.remove();state.drag=null;}},true);
  }else{state.meta=meta;state.entry=entry;}
  const svg=chartEl.querySelector('svg[role="img"]'),active=filters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===meta.id&&filter.field===field&&filter.op==='date-between');
  if(!svg||!active){svg?.querySelector(':scope > rect.db-time-brush')?.remove();return;}
  const points=brushPoints(svg,state),a=brushXAtDate(points,new Date(`${active.values[0]}T00:00:00Z`).getTime()),b=brushXAtDate(points,new Date(`${active.values[1]}T23:59:59Z`).getTime());
  if(points.length>1&&Number.isFinite(a)&&Number.isFinite(b)){const view=svg.viewBox.baseVal,rect=svg.querySelector(':scope > rect.db-time-brush')||document.createElementNS('http://www.w3.org/2000/svg','rect');rect.setAttribute('class','db-time-brush');rect.setAttribute('aria-hidden','true');rect.setAttribute('x',String(Math.min(a,b)));rect.setAttribute('y',String(view.y));rect.setAttribute('width',String(Math.abs(b-a)));rect.setAttribute('height',String(view.height));if(!rect.isConnected)svg.append(rect);}
}

function wireCrossfilter(chartEl, meta, entry) {
  const refreshSelection=()=>{
    const active=filters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===meta.id&&filter.field===entry.crossfilterField);
    const mode=meta.tileOptions?.crossfilterMode||'filter';
    const incoming=mode==='highlight'?filters.filter(filter=>filter.source==='crossfilter'&&filter.sourceTile!==meta.id&&filter.field===entry.crossfilterField):[];
    const marks=new Set([...chartEl.querySelectorAll('[data-crossfilter-values],a')].map(mark=>mark.closest('a')||mark));
    for(const mark of marks){
      const values=crossfilterValuesFromTarget(mark);
      if(!values?.length)continue;
      const selected=(!active||values.some(value=>active.values.some(item=>Object.is(item,value))))&&incoming.every(filter=>values.some(value=>filter.values.some(item=>Object.is(item,value))));
      if(active||incoming.length)mark.setAttribute('data-crossfilter-selected',String(selected));
      else mark.removeAttribute('data-crossfilter-selected');
      mark.setAttribute('aria-description',`Activate to filter other charts. This chart will ${mode==='filter'?'filter rows':mode==='highlight'?'highlight matching marks':'ignore incoming selections'}. Hold Control or Command while selecting to add or remove values.`);
    }
  };
  chartEl.onclick=(event)=>{
    if (!entry.crossfilterField) return;
    const values=crossfilterValuesFromTarget(event.target);
    if (!values?.length) return;
    event.preventDefault();
    const current=filters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===meta.id&&filter.field===entry.crossfilterField);
    const sameSource=!!current;
    let nextValues=values;
    if((event.ctrlKey||event.metaKey)&&sameSource){
      const selected=new Map(current.values.map(value=>[JSON.stringify([typeof value,value]),value]));
      const keys=values.map(value=>JSON.stringify([typeof value,value]));
      if(keys.every(key=>selected.has(key)))for(const key of keys)selected.delete(key);
      else for(const [index,key] of keys.entries())selected.set(key,values[index]);
      nextValues=[...selected.values()];
    }else if(sameSource&&values.length===current.values.length&&values.every(value=>current.values.some(item=>Object.is(item,value)))){
      nextValues=[];
    }
    const next=filters.filter(filter=>filter!==current);
    if (nextValues.length) next.push({id:current?.id||`cross-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,field:entry.crossfilterField,op:'is',values:nextValues,source:'crossfilter',sourceTile:meta.id});
    for(const tile of tileMeta.values())tile.drillValues=null;
      const action=meta.tileOptions?.clickAction||'filter-and-inspect';
      meta.drillValues=action==='filter-only'?null:values;
      if(action==='inspect-only'){
        for(const tile of tileMeta.values()){
          tile.drillValues=null;
          gridEl.querySelector(`.grid-stack-item[gs-id="${CSS.escape(tile.id)}"] .chart-drillthrough`)?.remove();
        }
        meta.drillValues=values;
        renderDrillRows(chartEl,meta,entry.crossfilterField,values);
        return;
      }
    setFilters(next);
  };
  wireTimeBrush(chartEl,meta,entry);
  refreshSelection();
  if(meta.drillValues?.length)renderDrillRows(chartEl,meta,entry.crossfilterField,meta.drillValues);
}

function renderDrillRows(chartEl,meta,field,values){
  if(!Array.isArray(meta.filterRows)||!field)return;
  const base=applyFilters(meta.filterRows,filtersForTile(meta),{sourceTile:meta.id}).rows;
  const rows=base.filter(row=>values.some(value=>Object.is(row[field],value)));
  if(!rows.length)return;
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].map(key=>({key}));
  const details=chartData(rows,columns,`${meta.title} — selected mark`);
  details.classList.add('chart-drillthrough');
  details.open=true;
  chartEl.append(details);
}

function renderTile(el) {
  if (!el.isConnected) return;
  const node = el.gridstackNode;
  if (!node) return;
  const meta = tileMeta.get(node.id);
  if (!meta) return;
  const entry = TILE_TYPES[meta.type];
  const chartEl = el.querySelector(".tile-chart");
  if (!entry || !chartEl) return;

  if (entry.noData) {
    entry.render(chartEl,{data:[],options:{title:meta.title,source:meta.source,tileOptions:meta.tileOptions,sizing:meta.sizing}});
    return;
  }

  if (isQueryRef(meta.dataset)) {
    renderQueryTile(el, meta, entry, chartEl);
    return;
  }

  let data;
  try { data = resolveTileData(meta, entry); } catch (err) { paintUnavailable(chartEl,"Data precision error",err.message); return; }
  if (!data) {
    if (meta.dataset == null) {
      // Following the dashboard default, but it is missing or can't be
      // mapped to this chart type: say so on the tile instead of silently
      // reverting to sample data. The tile keeps following the dashboard.
      chartEl.innerHTML = "";
      const box = document.createElement("div");
      box.className = "tile-error";
      const head = document.createElement("div");
      head.className = "tile-error-title";
      head.textContent = "Dashboard data unavailable";
      const msg = document.createElement("div");
      msg.className = "tile-error-msg";
      msg.textContent =
        `Couldn't use "${dashboardDefaultName()}" for this chart type. ` +
        "Pick data for this tile, or choose a different dashboard dataset.";
      box.append(head, msg);
      chartEl.appendChild(box);
      return;
    }
    paintUnavailable(chartEl, 'Data unavailable', 'The saved reference ' + meta.dataset + ' is missing. Choose Data to repair the binding.');
    return;
  }
  meta.filterRows = data;
  const prepared=prepareTileRows(meta,data);
  meta.renderRows=prepared.rows;
  if (prepared.empty) { paintFilteredEmpty(chartEl); return; }
  entry.render(chartEl, {
    data: prepared.rows,
    options: { title: meta.title, source: meta.source, tileOptions: meta.tileOptions, sizing: meta.sizing, hideTitle: !document.body.classList.contains("present"), crossfilterField: entry.crossfilterField }
  });
  wireCrossfilter(chartEl,meta,entry);
}

// Query tiles resolve asynchronously: the DuckDB module (and its .wasm) loads
// lazily on first use. Cached results render synchronously; otherwise the tile
// shows a brief loading state while the query runs.
async function renderQueryTile(el, meta, entry, chartEl) {
  const qid = queryId(meta.dataset);
  const q = getQuery(qid);
  const capturedRevision = datasetVersion();
  const renderToken = meta.renderToken = (meta.renderToken || 0) + 1;
  const capturedDataset = meta.dataset; // stale-render guard (see below)
  const capturedParameters = structuredClone(parameters);
  const options = () => ({
    title: meta.title,
    source: meta.source,
    tileOptions: meta.tileOptions, sizing: meta.sizing, hideTitle: !document.body.classList.contains("present"), crossfilterField: entry.crossfilterField
  });
  const paintRows = rows => {
    meta.filterRows = rows;
    const prepared=prepareTileRows(meta,rows);
    meta.renderRows=prepared.rows;
    if (prepared.empty) { paintFilteredEmpty(chartEl); return; }
    entry.render(chartEl,{data:prepared.rows,options:options()});
    wireCrossfilter(chartEl,meta,entry);
  };

  if (!q) {
    paintUnavailable(chartEl, 'Saved query unavailable', 'Reference ' + meta.dataset + ' was retained. Choose Data to repair it.');
    return;
  }

  try {
  const { getCachedRows, runTileQuery } = await import("./data/duckdb.js");
  if (!el.isConnected || tileMeta.get(meta.id) !== meta || meta.renderToken !== renderToken || meta.dataset !== capturedDataset) return;
  const cached = getCachedRows(qid, q, entry, capturedParameters);
  if (cached) {
    paintRows(cached);
    if (meta.sizing === "auto") requestAnimationFrame(() => { if (meta.sizing === "auto") fitTileToContent(grid, el); });
    return;
  }

  chartEl.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "tile-loading";
  loading.textContent = "Running query…";
  chartEl.appendChild(loading);

    const rows = await runTileQuery(qid, q, entry, capturedParameters);
    // The tile may have been removed, re-bound, or re-rendered while the
    // query was in flight — never paint a stale result.
    if (!el.isConnected || tileMeta.get(meta.id) !== meta || meta.renderToken !== renderToken || datasetVersion() !== capturedRevision || meta.dataset !== capturedDataset) return;
    paintRows(rows);
  } catch (err) {
    if (!el.isConnected || tileMeta.get(meta.id) !== meta || meta.renderToken !== renderToken || datasetVersion() !== capturedRevision || meta.dataset !== capturedDataset) return;
    paintUnavailable(chartEl, 'Query unavailable', (err?.message || String(err)) + ' Choose Data to repair or rerun this query.');
  }

  // Painted above (stale renders returned early): frame the tile, unless
  // the user sized it manually.
  if (meta.sizing === "auto") requestAnimationFrame(() => { if (meta.sizing === "auto") fitTileToContent(grid, el); });
}

subscribeDatasetChanges(() => refreshQueryTiles());

// Re-render every query tile (used after uploads/imports change the tables).
function refreshQueryTiles() {
  gridEl.querySelectorAll(".grid-stack-item").forEach((el) => {
    const node = el.gridstackNode;
    const meta = node && tileMeta.get(node.id);
    if (meta && isQueryRef(meta.dataset)) renderTile(el);
  });
}

function renderTileById(id) {
  const el = gridEl.querySelector(`[gs-id="${id}"]`);
  if (el) {
    renderTile(el);
    fitTileNow(el);
  }
}

// Size a tile's rows to frame its rendered content — unless the user sized
// it manually (resizestop), which is never overridden. Safe to call any
// time: no-ops when the tile is gone or already fits. Query tiles paint
// asynchronously, so they fit themselves when their query resolves.
function fitTileNow(el) {
  const node = el.gridstackNode;
  const meta = node && tileMeta.get(node.id);
  if (!meta || meta.sizing !== "auto" || isQueryRef(meta.dataset)) return;
  requestAnimationFrame(() => { if (meta.sizing === "auto") fitTileToContent(grid, el); });
}

// ── Layout serialization ─────────────────────────────────────────────────
function serializeLayout() {
  return {
    app: "dashboard-builder",
    version: 3,
    rowHeight: ROW_HEIGHT,
    savedAt: new Date().toISOString(),
    defaultDataset: dashboardDefault,
    filters,
    parameters,
    theme: getThemeId(),
    tiles: grid.save(false).map((n) => {
      const meta = tileMeta.get(n.id) || {};
      return {
        id: n.id,
        type: meta.type,
        title: meta.title,
        source: meta.source,
        dataset: meta.dataset,
        binding: TILE_TYPES[meta.type]?.noData ? { mode: "none" } : meta.dataset == null ? { mode: "dashboard" } : { mode: "explicit", ref: meta.dataset },
        sizing: meta.sizing,
        tileOptions: meta.tileOptions,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h
      };
    })
  };
}

let bulkLoading = false; // suppresses autosave while a layout is being loaded

function loadLayout(data, { fit = false } = {}) {
  data = validateLayout(data);
  bulkLoading = true;
  try {
    grid.removeAll();
    tileMeta.clear();
    dashboardDefault = validateDashboardDefault(data.defaultDataset);
    filters = data.filters || [];
    parameters = data.parameters || [];
    refreshDashboardButton();
    if (data.theme) {
      setTheme(data.theme);
      refreshThemeButton();
    }
    for (const t of data.tiles) {
      addTile(t.type, { ...t, fit });
    }
  } finally {
    bulkLoading = false;
  }
}

// Apply a template: like loadLayout, but the template's explicit sample
// datasets are kept as-is (no 2b-era migration) and the dashboard-wide
// default is left untouched — a template should look like its preview.
function applyTemplate(tpl) {
  try {
    const candidate = validateLayout({ app: 'dashboard-builder', version: tpl.rowHeight ? 3 : 1, rowHeight: tpl.rowHeight, theme: tpl.theme || getThemeId(), defaultDataset: dashboardDefault, filters: [], parameters: [], tiles: tpl.tiles });
    replaceLayout(candidate);
    scheduleAutosave(); setStatus('Applied template “' + tpl.name + '”.');
  } catch (err) { setStatus('Template failed: ' + err.message); }
}
function replaceLayout(candidate, { fit = false } = {}) {
  const previous = serializeLayout();
  // Construct controls/charts detached before changing the current grid.
  for (const t of candidate.tiles) {
    const host = document.createElement('div');
    buildTileContent(t.type,t);
    const entry = TILE_TYPES[t.type];
    const ds = t.dataset?.startsWith('upload:') ? candidate.datasets[uploadId(t.dataset)] || getDataset(uploadId(t.dataset)) : null;
    const rows = ds?.rows || DATASETS[t.dataset];
    if (rows) entry.render(host,{ data: rows, options: t });
  }
  try { loadLayout(candidate, { fit }); }
  catch (err) { loadLayout(previous); throw err; }
}

// ── Persistence: autosave + explicit save ────────────────────────────────
let saveTimer = null;
function scheduleAutosave() {
  if (bulkLoading) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLayout()));
      setStatus("Autosaved " + new Date().toLocaleTimeString());
    } catch {
      setStatus("Autosave failed: storage unavailable");
    }
  }, 400);
}

function saveNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLayout()));
    setStatus("Saved " + new Date().toLocaleTimeString());
  } catch {
    setStatus("Save failed: storage unavailable");
  }
}

// ── Grid events ──────────────────────────────────────────────────────────
// Coalesce pointer redraws to one frame. Rendering never runs in GridStack's
// synchronous start/stop cleanup stack and never replaces handles.
const pendingResize = new Map();
let resizeFrame = 0;
function scheduleResize(el) {
  pendingResize.set(el, true);
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    for (const tile of pendingResize.keys()) {
      if (!tile.isConnected) continue;
      const meta = tileMeta.get(tile.gridstackNode?.id);
      try { resizeTileChart(tile.querySelector('.tile-chart'), { sizing: meta?.sizing, hideTitle: !document.body.classList.contains('present') });if(meta)wireCrossfilter(tile.querySelector('.tile-chart'),meta,TILE_TYPES[meta.type]); }
      catch (err) { setStatus('Resize render failed: ' + err.message); }
    }
    pendingResize.clear();
  });
}
grid.on('resizestart', (_event, el) => {
  const meta = tileMeta.get(el.gridstackNode?.id);
  if (meta) meta.sizing = 'manual';
});
grid.on('resize', (_event, el) => scheduleResize(el));
grid.on('resizestop', (_event, el) => { scheduleResize(el); scheduleAutosave(); });
let viewportFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    gridEl.querySelectorAll('.grid-stack-item').forEach(el => { scheduleResize(el); fitTileNow(el); });
  });
});
grid.on("change", () => scheduleAutosave());
grid.on("removed", (_event, items) => {
  for (const n of items) tileMeta.delete(n.id);
  const removed=new Set(items.map(item=>item.id));
  const next=filters.flatMap(filter=>{
    if (filter.source==='crossfilter') return removed.has(filter.sourceTile) ? [] : [filter];
    if (!filter.targets) return [filter];
    const targets=filter.targets.filter(target=>!removed.has(target.tileId));
    return targets.length ? [{...filter,targets}] : [];
  });
  if (!bulkLoading && next.length!==filters.length) setFilters(next);
  else scheduleAutosave();
});

// ── Palette: drag onto the grid (GridStack drag-in) or click to add ──────
const paletteEl = document.getElementById("palette-items");
const paletteItems = [];
for (const [type, entry] of Object.entries(TILE_TYPES)) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "palette-item";
  item.dataset.tileType = type;

  const label = document.createElement("div");
  label.className = "palette-item-label";
  label.textContent = entry.label;

  const desc = document.createElement("div");
  desc.className = "palette-item-desc";
  desc.textContent = entry.description;

  item.append(label, desc);
  item.addEventListener("click", () => {
    addTile(type, { fit: true });
    scheduleAutosave();
  });
  paletteEl.appendChild(item);
  paletteItems.push(item);
}

// Associate each palette item with its default widget size so drops land
// at a sensible size. helper:'clone' keeps the palette item in place.
GridStack.setupDragIn(
  ".palette-item",
  { helper: "clone", appendTo: "body" },
  paletteItems.map((el) => {
    const s = TILE_TYPES[el.dataset.tileType].defaultSize;
    return { w: s.w, h: s.h };
  })
);

grid.on("dropped", (_event, _prevNode, newNode) => {
  // GridStack created a raw widget from the dragged palette clone.
  // Swap it for a fully-wired tile of the same type at the drop position.
  const el = newNode.el;
  // The dropped node is a clone of the palette item, which carries
  // data-tile-type on its root (querySelector only matches descendants,
  // so check the root first).
  const src = el.querySelector("[data-tile-type]");
  const type = el.dataset.tileType || (src && src.dataset.tileType);
  const { x, y } = newNode;
  grid.removeWidget(el, true, false);
  if (type && TILE_TYPES[type]) {
    addTile(type, { x, y, fit: true });
    scheduleAutosave();
  }
});

// ── Header actions ───────────────────────────────────────────────────────
const btnData = document.getElementById("btn-data");
const btnFilters = document.getElementById("btn-filters");
const btnTemplates = document.getElementById("btn-templates");
const btnTheme = document.getElementById("btn-theme");
function dashboardFilterTiles() {
  return [...tileMeta.values()].flatMap(meta => {
    const entry=TILE_TYPES[meta.type];
    if (!entry || entry.noData) return [];
    let rows=meta.filterRows;
    if (!rows) {
      try { rows=resolveTileData(meta,entry); } catch { rows=null; }
    }
    if (!Array.isArray(rows) || !rows.length) return [];
    const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))].map(field=>{
      const type=filterFieldType(rows,field);
      return {field,type,...(type==='category' ? distinctValues(rows,field) : {})};
    });
    return [{id:meta.id,title:meta.title,fields}];
  });
}
function setFilters(next) {
  filters=validateFilters(next);
  renderAllTiles();
  scheduleAutosave();
}
function setParameters(next) {
  parameters=validateParameters(next);
  refreshQueryTiles();
  scheduleAutosave();
}
if (btnFilters) {
  btnFilters.addEventListener('click',e=>{
    e.stopPropagation();
    toggleFiltersPopover({
      anchor:btnFilters,
      filters,
      parameters,
      tiles:dashboardFilterTiles(),
      tileTitle:id=>tileMeta.get(id)?.title || id,
      onFiltersChange:setFilters,
      onParametersChange:setParameters
    });
  });
}
function refreshThemeButton() {
  if (btnTheme) btnTheme.textContent = `Theme: ${getTheme().name}`;
}
if (btnTheme) {
  refreshThemeButton();
  btnTheme.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleThemePopover({
      anchor: btnTheme,
      current: getThemeId(),
      onSelect: (id) => {
        setTheme(id);
        refreshThemeButton();
        renderAllTiles();
        scheduleAutosave();
        setStatus(`Theme: ${getTheme().name}`);
      }
    });
  });
}
if (btnTemplates) {
  btnTemplates.addEventListener("click", (e) => {
    e.stopPropagation();
    openTemplateGallery({
      applyTemplate,
      getCurrentTiles: () => serializeLayout().tiles.map(({ id, ...rest }) => rest),
      getCurrentTheme: getThemeId,
      notify: setStatus
    });
  });
}
function refreshDashboardButton() {
  if (btnData) btnData.textContent = `Data: ${dashboardDefaultName()}`;
}
function refreshAllDataLabels() {
  gridEl.querySelectorAll(".grid-stack-item").forEach((el) => {
    const node = el.gridstackNode;
    const meta = node && tileMeta.get(node.id);
    const lab = el.querySelector(".tile-data-label");
    if (meta && lab) lab.textContent = datasetDisplayName(meta);
  });
}
function renderAllTiles() {
  gridEl.querySelectorAll(".grid-stack-item").forEach((el) => {
    renderTile(el);
    fitTileNow(el);
  });
}
function applyDashboardDefault(dd, statusMsg) {
  dashboardDefault = dd;
  refreshDashboardButton();
  refreshAllDataLabels();
  renderAllTiles();
  scheduleAutosave();
  if (statusMsg) setStatus(statusMsg);
}
async function applyGuidedDashboard({ id, name, suggestions, persisted }) {
  if (grid.save(false).length && !window.confirm("Replace the current dashboard with these suggested charts? Export JSON first if you want to keep a separate copy.")) return false;
  try {
    const original = getDataset(id);
    const raw = original?.raw || (original ? { columns: original.columns, rows: original.rows } : null);
    if (!raw) throw new Error("The uploaded file is no longer available.");
    const multi = suggestions.length > 1;
    const prepared = suggestions.map((suggestion) => ({
      suggestion,
      entry: TILE_TYPES[suggestion.type],
      rows: normalizeRows(TILE_TYPES[suggestion.type], raw.rows, suggestion.mapping).rows
    }));
    const chartDatasets = [];
    for (const { suggestion, entry, rows } of prepared) {
      const dataset = saveDataset({
        name,
        columns: raw.columns,
        rows,
        fieldKeys: entry.fields.map((field) => field.key),
        mapping: { ...suggestion.mapping },
        raw: null
      });
      const durable = await persistDataset(dataset.id);
      chartDatasets.push({ id: dataset.id, durable });
    }
    const candidate = validateLayout({
      app: "dashboard-builder",
      version: 3,
      rowHeight: ROW_HEIGHT,
      theme: getThemeId(),
      defaultDataset: { kind: "dataset", ref: `upload:${id}` },
      tiles: suggestions.map((suggestion, index) => {
        const entry = TILE_TYPES[suggestion.type];
        return {
          id: `guided-${Date.now().toString(36)}-${index}`,
          type: suggestion.type,
          title: suggestion.title,
          source: name,
          dataset: `upload:${chartDatasets[index].id}`,
          binding: { mode: "explicit", ref: `upload:${chartDatasets[index].id}` },
          sizing: "auto",
          tileOptions: {},
          x: multi ? (index % 2) * 6 : 0,
          y: multi ? Math.floor(index / 2) * Math.max(15, entry.defaultSize.h) : 0,
          w: multi ? 6 : 12,
          h: Math.max(6, entry.defaultSize.h)
        };
      })
    });
    replaceLayout(candidate, { fit: true });
    scheduleAutosave();
    const allDurable = persisted && chartDatasets.every((dataset) => dataset.durable);
    setStatus(`Built ${suggestions.length} suggested chart${suggestions.length === 1 ? "" : "s"} from ${name}.` + (allDurable ? "" : " Some upload data is session only; export JSON for a backup."));
    return true;
  } catch (error) {
    setStatus(`Suggested dashboard failed: ${error.message}`);
    return false;
  }
}
if (btnData) {
  btnData.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDashboardPopover({
      anchor: btnData,
      current: dashboardDefault,
      sampleKeys: Object.keys(DATASETS),
      onSelect: ({ kind, ref }) => {
        const dd = kind === "samples" ? { kind: "samples" } : { kind: "dataset", ref };
        applyDashboardDefault(dd);
        setStatus(`Dashboard data: ${dashboardDefaultName()}`);
      },
      onUpload: async ({ name, columns, rows, profile }) => {
        const { id } = saveDataset({
          name,
          columns,
          rows,
          fieldKeys: [],
          mapping: {},
          raw: { columns, rows }
        });
        const persisted = await persistDataset(id);
        openGuidedStart({
          id,
          name,
          profile,
          onUseData: () => applyDashboardDefault(
            { kind: "dataset", ref: `upload:${id}` },
            persisted
              ? `Dashboard data: ${name}`
              : `Dashboard data: ${name} — browser storage unavailable, kept for this session only.`
          ),
          onApply: (selection) => applyGuidedDashboard({ ...selection, persisted }),
          onKeep: () => setStatus(persisted
            ? `Upload saved: ${name}. Current dashboard kept.`
            : `Upload available for this session only: ${name}. Current dashboard kept.`)
        });
      }
    });
  });
}

document.getElementById("btn-save").addEventListener("click", saveNow);

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("btn-export").addEventListener("click", async () => {
  const layout = serializeLayout();
  // Inline small uploaded datasets so the exported file is self-contained.
  // Includes the dashboard-wide default dataset, not just per-tile uploads.
  const refs = layout.tiles.map((t) => t.dataset).filter(isUploadRef);
  if (layout.defaultDataset?.kind === "dataset" && isUploadRef(layout.defaultDataset.ref)) {
    refs.push(layout.defaultDataset.ref);
  }
  const queryRefs = layout.tiles.map(t => t.dataset).filter(isQueryRef);
  for (const qref of queryRefs) {
    const q = getQuery(queryId(qref));
    if (q?.dependencies) refs.push(...q.dependencies.filter(isUploadRef));
    else refs.push(...listDatasets().map(ds => 'upload:' + ds.id));
  }
  const { inlined, skipped } = inlineDatasets([...new Set(refs)]);
  for (const qref of queryRefs) if (!getQuery(queryId(qref))) skipped.push(qref + ' (missing query)');
  for (const t of layout.tiles.filter(t => isQueryRef(t.dataset))) {
    const resolved = await resolveExportRows(t,TILE_TYPES[t.type]);
    if (resolved.error && !skipped.some(s => s.startsWith(t.dataset))) skipped.push(t.dataset + ": " + resolved.error);
  }
  layout.omittedDependencies = skipped;
  if (skipped.length && !window.confirm('This JSON will omit these dependencies:\n' + skipped.join('\n') + '\nExport with unavailable-data references retained?')) { setStatus('JSON export cancelled.'); return; }
  if (Object.keys(inlined).length) layout.datasets = inlined;
  // Queries are small text: always inline them, same treatment.
  const inlinedQueries = inlineQueries(layout.tiles.map((t) => t.dataset).filter(isQueryRef));
  if (Object.keys(inlinedQueries).length) layout.queries = inlinedQueries;
  download(
    `dashboard-layout-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(layout, null, 2)
  );
  setStatus(
    skipped.length
      ? `Exported layout JSON (not inlined, over size limit: ${skipped.join(", ")})`
      : "Exported layout JSON"
  );
});

// Phase 4: static HTML export. Fetches the prebuilt single-file viewer
// template (public/export-template.html — served by `vite dev`, copied to
// dist/ by `vite build`), injects the dashboard payload with resolved
// per-tile rows, and downloads the result. The exported file renders the
// same themed charts with no network dependencies and no editor chrome.
async function exportHtml() {
  const exportRevision = datasetVersion();
  const snapshotSignature = () => { const { savedAt, ...layout } = serializeLayout(); return JSON.stringify(layout); };
  const exportLayout = snapshotSignature();
  setStatus("Preparing HTML export…");
  try {
    const res = await fetch(new URL("export-template.html", window.location.href));
    if (!res.ok) {
      throw new Error(`export template not found (HTTP ${res.status}) — run “npm run build” once`);
    }
    const template = await res.text();
    if (!template.includes("__DASHBOARD_PAYLOAD__")) {
      throw new Error("export template is stale (payload placeholder missing) — run “npm run build” once");
    }

    const tiles = [];
    for (const el of gridEl.querySelectorAll(".grid-stack-item")) {
      const node = el.gridstackNode;
      if (!node) continue;
      const meta = tileMeta.get(node.id);
      const entry = meta && TILE_TYPES[meta.type];
      if (!meta || !entry) continue;
      const resolved = await resolveExportRows(meta, entry);
      tiles.push({
        id: meta.id,
        type: meta.type,
        crossfilterField: entry.crossfilterField || null,
        title: meta.title,
        source: meta.source,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        tileOptions: meta.tileOptions || {},
        rows: resolved.error ? null : resolved.rawRows || resolved.rows || null,
        error: resolved.error || null,
        emptyMessage: null
      });
    }

    const payload = {
      app: "dashboard-builder",
      version: 3,
    rowHeight: ROW_HEIGHT,
      kind: "dashboard-export",
      title: serializeLayout().title || "Dashboard",
      exportedAt: new Date().toISOString(),
      theme: getThemeId(),
      filters: filters.map(filter => ({ ...filter, values: [...filter.values], targets: filter.targets?.map(target => ({ ...target })) })),
      tiles
    };
    // Escape < so a data value can never break out of the JSON script tag.
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    if (json.length > 20 * 1024 * 1024) {
      const mb = (json.length / (1024 * 1024)).toFixed(1);
      if (!window.confirm(`This export is about ${mb} MB (large datasets are inlined). Continue?`)) {
        setStatus("HTML export cancelled.");
        return;
      }
    }
    if (exportRevision !== datasetVersion() || exportLayout !== snapshotSignature()) throw new Error("Dashboard changed during export. Export again.");
    const html = template.replace("__DASHBOARD_PAYLOAD__", () => json);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dashboard.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(`Exported dashboard.html (${(html.length / 1024).toFixed(0)} KB, ${tiles.length} tiles).`);
  } catch (err) {
    setStatus(`HTML export failed: ${err && err.message ? err.message : err}`);
  }
}

document.getElementById("btn-export-html").addEventListener("click", exportHtml);

const fileInput = document.getElementById("file-import");
document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > LIMITS.layoutBytes) { setStatus("Import limit is 32 MiB."); fileInput.value = ""; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = validateLayout(JSON.parse(reader.result));
      assertNoCollisions(data,getDataset,getQuery);
      const previous = serializeLayout();
      const queriesBefore = querySnapshot();
      const layoutRaw = localStorage.getItem(STORAGE_KEY);
      const queryRaw = localStorage.getItem('dashbuilder.queries.v1');
      const newIds = Object.keys(data.datasets).filter(id => !hasDataset(id));
      // Retain a durable recovery copy before the first replacement mutation.
      localStorage.setItem(STORAGE_KEY + ':recovery',JSON.stringify({ layout: previous, queries: queriesBefore }));
      let restored = 0, restoredQueries = 0;
      clearTimeout(saveTimer);
      bulkLoading = true;
      try {
        // Detached construction checks run before any durable dataset write.
        for (const t of data.tiles) buildTileContent(t.type,t);
        restored = await restoreDatasets(data.datasets);
        restoredQueries = restoreQueries(data.queries);
        replaceLayout(data);
        localStorage.setItem('dashbuilder.queries.v1',serializeQueries());
        localStorage.setItem(STORAGE_KEY,JSON.stringify(serializeLayout()));
      } catch (err) {
        rollbackQueries(queriesBefore);
        loadLayout(previous);
        if (restored) await rollbackDatasets(newIds);
        if (queryRaw === null) localStorage.removeItem('dashbuilder.queries.v1'); else localStorage.setItem('dashbuilder.queries.v1',queryRaw);
        if (layoutRaw === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY,layoutRaw);
        throw err;
      } finally { bulkLoading = false; }
      refreshQueryTiles();
      const bits = [];
      if (restored) bits.push(`${restored} dataset${restored === 1 ? "" : "s"}`);
      if (restoredQueries) bits.push(`${restoredQueries} quer${restoredQueries === 1 ? "y" : "ies"}`);
      setStatus(`Imported ${file.name}` + (bits.length ? ` (${bits.join(", ")} restored)` : ""));
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    }
    fileInput.value = "";
  };
  reader.readAsText(file);
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!grid.save(false).length) return;
  if (window.confirm("Remove all tiles from the grid?")) {
    grid.removeAll();
    tileMeta.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable; grid is still cleared */
    }
    setStatus("Grid cleared");
  }
});

// ── Present mode ─────────────────────────────────────────────────────────
const btnPresent = document.getElementById("btn-present");
const btnExitPresent = document.getElementById("btn-exit-present");

function setPresent(on) {
  document.body.classList.toggle("present", on);
  btnExitPresent.hidden = !on;
  grid.setStatic(on); // locks drag + resize
  if (on) {
    firstRunHint?.remove();
    firstRunHint = null;
    closeDataPopover();
    closeDashboardPopover();
    closeThemePopover();
  } else {
    showFirstRunHint();
  }
  // Charts keep their rendered width; re-render in case chrome changes it.
  requestAnimationFrame(() =>
    gridEl.querySelectorAll(".grid-stack-item").forEach((el) => {
      renderTile(el);
    })
  );
}

btnPresent.addEventListener("click", () => setPresent(true));
btnExitPresent.addEventListener("click", () => setPresent(false));

let firstRunHint = null;
function showFirstRunHint() {
  if (document.body.classList.contains("present") || firstRunHint?.isConnected) return;
  try {
    if (localStorage.getItem(FIRST_RUN_HINT_KEY) === "1") return;
  } catch {
    // The hint remains available when storage cannot be read.
  }

  const hint = document.createElement("aside");
  hint.className = "first-run-hint";
  hint.setAttribute("aria-labelledby", "first-run-hint-title");
  const heading = document.createElement("strong");
  heading.id = "first-run-hint-title";
  heading.textContent = "Getting started";
  const list = document.createElement("ul");
  for (const text of [
    "Charts: drag one onto the grid or click to add it.",
    "A tile’s Data button binds samples, uploads, or SQL to that chart.",
    "Export HTML creates a shareable dashboard file."
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Got it";
  dismiss.addEventListener("click", () => {
    try { localStorage.setItem(FIRST_RUN_HINT_KEY, "1"); } catch { /* dismiss for this page */ }
    hint.remove();
    firstRunHint = null;
  });
  hint.append(heading, list, dismiss);
  document.body.appendChild(hint);
  firstRunHint = hint;
}

// ── Startup: restore autosaved layout, else a starter dashboard ──────────
function starterLayout() {
  return {
    app: "dashboard-builder",
    version: 3, rowHeight: ROW_HEIGHT,
    tiles: [
      { type: "kpi", title: "Headlines", dataset: "kpis", x: 0, y: 0, w: 12, h: 13, binding: {mode:"explicit",ref:"kpis"} },
      { type: "bar", title: "Requests by category", dataset: "categorical", x: 0, y: 13, w: 6, h: 16, binding: {mode:"explicit",ref:"categorical"} },
      { type: "line", title: "Monthly requests", dataset: "timeseries", x: 6, y: 13, w: 6, h: 16, binding: {mode:"explicit",ref:"timeseries"} },
      { type: "donut", title: "Share of requests", dataset: "categorical", x: 0, y: 29, w: 4, h: 20, binding: {mode:"explicit",ref:"categorical"} },
      { type: "scatter", title: "Rent burden vs. homelessness rate", dataset: "scatter", x: 4, y: 29, w: 8, h: 20, binding: {mode:"explicit",ref:"scatter"} }
    ]
  };
}

(async function init() {
  const restoredCount = await loadPersistedDatasets(); // IndexedDB, before any tile renders
  loadPersistedQueries(); // saved SQL queries, before any tile renders
  let restored = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      loadLayout(JSON.parse(raw));
      restored = true;
      setStatus(
        "Restored autosaved layout" +
          (restoredCount ? ` (${restoredCount} dataset${restoredCount === 1 ? "" : "s"} loaded)` : "")
      );
    }
  } catch {
    restored = false; // corrupt or unreadable save: fall through to starter
  }
  if (!restored) {
    loadLayout(starterLayout());
    setStatus("Starter dashboard loaded");
  }
  const issues = storageIssues();
  if (issues.length) {
    setStatus(issues.join("; ") + ". Export JSON for backup or retry migration.");
    const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry data migration";
    retry.onclick = async () => { await loadPersistedDatasets(); setStatus(storageIssues().join("; ") || "Migration verified."); };
    statusEl.after(retry);
  }
  setStatus(`${statusEl.textContent} · build ${BUILD}`);
  showFirstRunHint();
})();
