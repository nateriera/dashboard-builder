// Static export viewer: renders an exported dashboard payload with the same
// themed chart components as the composer. The payload is embedded in
// <script id="dashboard-data" type="application/json"> by the exporter.
// No network, no editor chrome — charts re-render on window resize.

import "./style.css";
import { TILE_TYPES } from "../tiles/registry.js";
import { chartStyles } from "../charts/charts.js";
import { previewTheme } from "../themes/themes.js";
import { applyFilters, sortAndLimitRows } from "../data/filters.js";
import { chartData } from "../ui/chartData.js";

document.head.appendChild(chartStyles);

function readPayload() {
  try {
    const el = document.getElementById("dashboard-data");
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    if (!data || !Array.isArray(data.tiles)) return null;
    return data;
  } catch {
    return null;
  }
}

const payload = readPayload();
const root = document.getElementById("export-root");
const crossfilterHref = mark => mark.getAttributeNS?.("http://www.w3.org/1999/xlink", "href") || mark.getAttribute?.("href") || "";

// The export carries its theme; activate it for rendering without touching
// the viewer's own stored preference (previewTheme, not setTheme).
previewTheme(payload && payload.theme);

if (!payload) {
  document.title = "Dashboard";
  root.innerHTML = "";
  const p = document.createElement("p");
  p.className = "export-notice";
  p.textContent = "This file doesn't contain dashboard data.";
  root.appendChild(p);
} else {
  document.title = payload.title || "Dashboard";
  renderExport(payload);
}

function renderExport(payload) {
  root.innerHTML = "";

  const head = document.createElement("header");
  head.className = "export-head";
  const h1 = document.createElement("h1");
  h1.textContent = payload.title || "Dashboard";
  head.appendChild(h1);
  if (payload.exportedAt) {
    const meta = document.createElement("p");
    meta.className = "export-meta";
    try {
      meta.textContent = `Exported ${new Date(payload.exportedAt).toLocaleString()}`;
    } catch {
      meta.textContent = "Exported dashboard";
    }
    head.appendChild(meta);
  }
  root.appendChild(head);

  const controls = document.createElement("section");
  controls.className = "export-filters";
  controls.setAttribute("aria-label", "Dashboard filters");
  const filterHeading = document.createElement("h2");
  filterHeading.textContent = "Filters";
  controls.appendChild(filterHeading);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Reset filters";
  controls.appendChild(clear);
  const crossfilterList=document.createElement('div');
  crossfilterList.className='export-crossfilters';
  crossfilterList.setAttribute('aria-label','Chart selections');
  controls.appendChild(crossfilterList);
  let filters = (payload.filters || []).map(filter => ({ ...filter, values: [...filter.values] }));
  const editableFilters = filters.filter(filter => filter.source !== "crossfilter");
  const defaults = editableFilters.map(filter => [...filter.values]);
  const filterBindings = [];
  let inspection=null;
  for (const [index, filter] of editableFilters.entries()) {
    const field = filter.targets?.[0]?.field || filter.field;
    const label = document.createElement("label");
    label.className = "export-filter";
    const name = document.createElement("span");
    name.textContent = field;
    label.appendChild(name);
    if (filter.op === "between" || filter.op === "date-between") {
      const date = filter.op === "date-between";
      let presetControl=null;
      if (date && filter.relativePreset) {
        const preset = document.createElement("select");
        presetControl=preset;
        preset.setAttribute("aria-label", `${field} date range preset`);
        for (const [value,label] of [["last-7-days","Last 7 days"],["last-30-days","Last 30 days"],["month-to-date","Month to date"],["last-month","Last month"],["year-to-date","Year to date"]]) {
          const option=document.createElement("option"); option.value=value; option.textContent=label; preset.appendChild(option);
        }
        preset.value=filter.relativePreset;
        preset.addEventListener("change",()=>{filter.relativePreset=preset.value;schedulePaint();});
        label.appendChild(preset);
      }
      const inputs = [0, 1].map((slot) => {
        const input = document.createElement("input");
        input.type = date ? "date" : "number";
        if (!date) input.step = "any";
        input.value = filter.values[slot];
        input.setAttribute("aria-label", `${field} ${slot === 0 ? "minimum" : "maximum"}`);
        input.addEventListener("input", () => {
          if(date&&presetControl){filter.relativePreset=undefined;presetControl.value="";}
          const pair = inputs.map(item => item.value);
          if (pair.some(value => value === "")) filter.values = [];
          else {
            const parsed = pair.map(value => date ? value : Number(value));
            filter.values = parsed[0] <= parsed[1] ? parsed : [parsed[1], parsed[0]];
          }
          schedulePaint();
        });
        label.appendChild(input);
        return input;
      });
      filterBindings.push({ filter, inputs, presetControl });
    } else {
      const select = document.createElement("select");
      select.multiple = true;
      select.setAttribute("aria-label", `${field} values`);
      const values = new Map();
      for (const tile of payload.tiles) {
        const target = filter.targets?.find(item => item.tileId === tile.id);
        const sourceField = target?.field || filter.field;
        for (const row of tile.rows || []) if (Object.hasOwn(row, sourceField) && values.size < 200) values.set(`${typeof row[sourceField]}:${JSON.stringify(row[sourceField])}`, row[sourceField]);
      }
      for (const value of values.values()) {
        const option = document.createElement("option");
        option.value = JSON.stringify(value);
        option.textContent = value == null ? "(blank)" : String(value);
        option.selected = filter.values.some(item => Object.is(item, value));
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        filter.values = [...select.selectedOptions].map(option => JSON.parse(option.value));
        schedulePaint();
      });
      label.appendChild(select);
      filterBindings.push({ filter, select });
    }
    controls.appendChild(label);
  }
  const hasInteractiveCharts=payload.tiles.some(tile=>tile.crossfilterField||(['line','area'].includes(tile.type)&&tile.rows?.some(row=>row.date)));
  if (editableFilters.length||hasInteractiveCharts) root.appendChild(controls);

  if (payload.tiles.length === 0) {
    const p = document.createElement("p");
    p.className = "export-notice";
    p.textContent = "This dashboard has no tiles.";
    root.appendChild(p);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "export-grid";
  grid.style.setProperty("--grid-row-height", `${payload.version >= 3 ? payload.rowHeight : 72}px`);
  root.appendChild(grid);

  const rendered = [];
  const brushStates = new WeakMap();
  for (const t of payload.tiles) {
    const entry = TILE_TYPES[t.type];
    if (!entry) continue;
    const tile = document.createElement("section");
    tile.dataset.tileId = t.id || "";
    tile.className = "export-tile";
    tile.style.gridColumn = `${t.x + 1} / span ${t.w}`;
    tile.style.gridRow = `${t.y + 1} / span ${t.h}`;
    const chartEl = document.createElement("div");
    chartEl.className = "tile-chart";
    tile.appendChild(chartEl);
    grid.appendChild(tile);
    rendered.push({ t, entry, chartEl });
  }

  const paint = () => {
    crossfilterList.replaceChildren();
    const activeCrossfilters=filters.filter(filter=>filter.source==='crossfilter');
    crossfilterList.hidden=!activeCrossfilters.length;
    for(const filter of activeCrossfilters){
      const source=payload.tiles.find(tile=>tile.id===filter.sourceTile),button=document.createElement('button');
      button.type='button';button.className='export-crossfilter-chip';
      const label=filter.op==='date-between'?`${filter.field} · ${filter.values[0]}–${filter.values[1]}`:`${filter.field} is ${filter.values.map(value=>value==null?'(blank)':String(value)).join(', ')}`;
      button.textContent=`${source?.title||'Chart'}: ${label} ×`;
      button.setAttribute('aria-label',`Clear ${source?.title||'chart'} selection`);
      button.addEventListener('click',()=>{filters=filters.filter(item=>item!==filter);inspection=null;paint();});
      crossfilterList.appendChild(button);
    }
    for (const { t, entry, chartEl } of rendered) {
      if (t.emptyMessage) {
        paintEmpty(chartEl,t.emptyMessage);
      } else if (t.rows) {
        try {
          const mode=t.tileOptions?.crossfilterMode||'filter';
          const activeFilters = filters.filter(filter => filter.values.length > 0 && (filter.source!=='crossfilter'||filter.sourceTile===t.id||mode==='filter'));
          const filtered = applyFilters(t.rows, activeFilters, { sourceTile: t.id });
          const sortable = ['bar','column','dot','stackedBar','stackedColumn'].includes(t.type);
          const data = sortable && t.tileOptions?.topN != null
            ? sortAndLimitRows(t.type, filtered.rows, { sort: t.tileOptions?.sort ?? 'desc', topN: t.tileOptions.topN })
            : filtered.rows;
          if (filtered.applied && data.length === 0) { paintEmpty(chartEl, "No rows match the active filters."); continue; }
          entry.render(chartEl, {
            data,
            options: {
              title: t.title,
              source: t.source,
              tileOptions: t.tileOptions || {}, sizing: window.matchMedia('print').matches ? 'auto' : 'manual',
              crossfilterField: t.crossfilterField || null
            }
          });
          wireOfflineTimeBrush(chartEl, t, entry, filtered.rows, filters);
          const active = filters.find(filter => filter.source === "crossfilter" && filter.sourceTile === t.id);
          const mappings=t.tileOptions?.crossfilterFieldMappings||{};
          const incoming=mode==='highlight'?filters.filter(filter=>filter.source==='crossfilter'&&filter.sourceTile!==t.id&&(mappings[filter.field]??(filter.field===entry.crossfilterField?entry.crossfilterField:null))===entry.crossfilterField):[];
          for (const mark of chartEl.querySelectorAll("a")) {
            const href = crossfilterHref(mark);
            if (!href.startsWith("#db-crossfilter:")) continue;
            let values = [];
            try { values = JSON.parse(decodeURIComponent(href.slice("#db-crossfilter:".length))); } catch { /* invalid link is inert */ }
            const selected=(!active||values.some(value=>active.values.some(item=>Object.is(item,value))))&&incoming.every(filter=>values.some(value=>filter.values.some(item=>Object.is(item,value))));
            if (active||incoming.length) mark.setAttribute("data-crossfilter-selected", String(selected));
            else mark.removeAttribute("data-crossfilter-selected");
            mark.setAttribute("aria-description", "Activate to filter other charts. Hold Control or Command while selecting to add or remove values.");
          }
          if(inspection?.tileId===t.id){
            const sourceFilters=filters.filter(filter=>filter.source!=='crossfilter'||filter.sourceTile===t.id||mode==='filter');
            const records=applyFilters(t.rows,sourceFilters,{sourceTile:t.id}).rows.filter(row=>inspection.values.some(value=>Object.is(row[entry.crossfilterField],value)));
            if(records.length){const details=chartData(records,[...new Set(records.flatMap(row=>Object.keys(row)))].map(key=>({key})),`${t.title} — selected records`);details.classList.add('chart-drillthrough');chartEl.append(details);details.open=true;}
          }
        } catch (err) {
          // Surface the real message: an export failure should name its cause.
          paintError(chartEl, "Couldn't render this chart.", err && err.message ? err.message : String(err));
        }
      } else {
        paintError(chartEl, "Data unavailable", t.error || "");
      }
    }
  };

  for (const { t, chartEl } of rendered) {
    wireOfflineBrushEvents(chartEl, t, () => filters, nextFilters => { filters = nextFilters; paint(); });
    chartEl.addEventListener("click", event => {
      const link = event.target.closest?.("a");
      if (!link || !crossfilterHref(link).startsWith("#db-crossfilter:") || !t.crossfilterField) return;
      let values;
      try { values = JSON.parse(decodeURIComponent(crossfilterHref(link).slice("#db-crossfilter:".length))); } catch { return; }
      if (!Array.isArray(values) || !values.length) return;
      event.preventDefault();
      const action=t.tileOptions?.clickAction||'filter-and-inspect';
      if(action==='inspect-only'){
        inspection={tileId:t.id,values};
        paint();
        return;
      }
      const current = filters.find(filter => filter.source === "crossfilter" && filter.sourceTile === t.id && filter.field === t.crossfilterField);
      const sameSource = !!current;
      let nextValues = values;
      if ((event.ctrlKey || event.metaKey) && sameSource) {
        const selected = new Map(current.values.map(value => [JSON.stringify([typeof value, value]), value]));
        const keys = values.map(value => JSON.stringify([typeof value, value]));
        if (keys.every(key => selected.has(key))) for (const key of keys) selected.delete(key);
        else for (const [index, key] of keys.entries()) selected.set(key, values[index]);
        nextValues = [...selected.values()];
      } else if (sameSource && values.length === current.values.length && values.every(value => current.values.some(item => Object.is(item, value)))) nextValues = [];
      filters = filters.filter(filter => filter !== current);
      if (nextValues.length) filters.push({ id: current?.id || `cross-export-${Date.now().toString(36)}`, field: t.crossfilterField, op: "is", values: nextValues, source: "crossfilter", sourceTile: t.id });
      inspection=action==='filter-only'||!nextValues.length?null:{tileId:t.id,values};
      paint();
    });
  }

  function wireOfflineBrushEvents(chartEl, tile, getFilters, updateFilters) {
    if (!['line','area'].includes(tile.type) || !tile.rows?.some(row => row.date)) return;
    if (chartEl.dataset.timeBrushBound) return;
    chartEl.dataset.timeBrushBound = 'true';
    const plotX = (svg, clientX) => {
      const bounds = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
      return view.x + (clientX - bounds.left) * view.width / bounds.width;
    };
    const brushRect = (svg) => {
      let rect = svg.querySelector(':scope > rect.db-time-brush');
      if (!rect) {
        rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('class','db-time-brush'); rect.setAttribute('aria-hidden','true'); svg.append(rect);
      }
      return rect;
    };
    const state = brushStates.get(chartEl) || { tile, rows: [], drag: null };
    brushStates.set(chartEl,state);
    chartEl.addEventListener('pointerdown',event=>{
      const svg=event.target.closest?.('svg[role="img"]');
      if(event.button!==0||!svg)return;
      const circles=[...svg.querySelectorAll('g[aria-label="dot"] circle')];
      const points=circles.slice(0,state.rows.length).flatMap((circle,index)=>{
        const x=Number(circle.getAttribute('cx')),time=new Date(state.rows[index]?.date).getTime();
        return Number.isFinite(x)&&Number.isFinite(time)?[{x,time}]:[];
      }).sort((a,b)=>a.x-b.x).filter((point,index,all)=>index===0||point.x!==all[index-1].x);
      if(points.length<2)return;
      const x=plotX(svg,event.clientX);
      if(x<points[0].x||x>points.at(-1).x)return;
      state.drag={svg,points,startX:x,currentX:x,pointerId:event.pointerId};
      svg.setPointerCapture?.(event.pointerId);
      const rect=brushRect(svg),view=svg.viewBox.baseVal;
      rect.setAttribute('x',String(x));rect.setAttribute('y',String(view.y));rect.setAttribute('width','0');rect.setAttribute('height',String(view.height));
      event.preventDefault();
    },true);
    chartEl.addEventListener('pointermove',event=>{
      const drag=state.drag;if(!drag||drag.pointerId!==event.pointerId)return;
      drag.currentX=plotX(drag.svg,event.clientX);
      const view=drag.svg.viewBox.baseVal,left=Math.max(drag.points[0].x,Math.min(drag.startX,drag.currentX)),right=Math.min(drag.points.at(-1).x,Math.max(drag.startX,drag.currentX)),rect=brushRect(drag.svg);
      rect.setAttribute('x',String(left));rect.setAttribute('y',String(view.y));rect.setAttribute('width',String(Math.max(0,right-left)));rect.setAttribute('height',String(view.height));
    },true);
    chartEl.addEventListener('pointerup',event=>{
      const drag=state.drag;if(!drag||drag.pointerId!==event.pointerId)return;state.drag=null;
      if(Math.abs(drag.currentX-drag.startX)<12){drag.svg.querySelector(':scope > rect.db-time-brush')?.remove();return;}
      const atX=x=>{
        const points=drag.points;if(x<=points[0].x)return points[0].time;if(x>=points.at(-1).x)return points.at(-1).time;
        const index=points.findIndex(point=>point.x>=x),a=points[index-1],b=points[index];return a.time+(b.time-a.time)*(x-a.x)/(b.x-a.x);
      };
      const values=[atX(Math.min(drag.startX,drag.currentX)),atX(Math.max(drag.startX,drag.currentX))].map(time=>new Date(time).toISOString().slice(0,10));
      const activeFilters=getFilters();
      const current=activeFilters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===tile.id&&filter.op==='date-between'&&filter.field==='date');
      const next=activeFilters.filter(filter=>filter!==current);
      next.push({id:current?.id||`cross-export-date-${Date.now().toString(36)}`,field:'date',op:'date-between',values,source:'crossfilter',sourceTile:tile.id});
      updateFilters(next);
    },true);
    chartEl.addEventListener('pointercancel',event=>{
      if(state.drag?.pointerId===event.pointerId){state.drag.svg.querySelector(':scope > rect.db-time-brush')?.remove();state.drag=null;}
    },true);
  }

  function wireOfflineTimeBrush(chartEl,t,entry,rows,activeFilters){
    if(!['line','area'].includes(t.type)||!entry.fields?.some(field=>field.key==='date'))return;
    const state=brushStates.get(chartEl);if(!state)return;
    state.tile=t;state.rows=rows;
    const svg=chartEl.querySelector('svg[role="img"][viewBox]');
    const active=activeFilters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===t.id&&filter.field==='date'&&filter.op==='date-between');
    if(!svg||!active){svg?.querySelector(':scope > rect.db-time-brush')?.remove();return;}
    const circles=[...svg.querySelectorAll('g[aria-label="dot"] circle')],points=circles.slice(0,rows.length).flatMap((circle,index)=>{
      const x=Number(circle.getAttribute('cx')),time=new Date(rows[index]?.date).getTime();return Number.isFinite(x)&&Number.isFinite(time)?[{x,time}]:[];
    }).sort((a,b)=>a.x-b.x).filter((point,index,all)=>index===0||point.x!==all[index-1].x);
    if(points.length<2)return;
    const xAt=time=>{
      const byTime=[...points].sort((a,b)=>a.time-b.time);
      if(time<=byTime[0].time)return byTime[0].x;if(time>=byTime.at(-1).time)return byTime.at(-1).x;
      const index=byTime.findIndex(point=>point.time>=time),a=byTime[index-1],b=byTime[index];return a.x+(b.x-a.x)*(time-a.time)/(b.time-a.time);
    };
    const a=xAt(new Date(`${active.values[0]}T00:00:00Z`).getTime()),b=xAt(new Date(`${active.values[1]}T23:59:59Z`).getTime()),view=svg.viewBox.baseVal;
    const rect=svg.querySelector(':scope > rect.db-time-brush')||document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('class','db-time-brush');rect.setAttribute('aria-hidden','true');rect.setAttribute('x',String(Math.min(a,b)));rect.setAttribute('y',String(view.y));rect.setAttribute('width',String(Math.abs(b-a)));rect.setAttribute('height',String(view.height));if(!rect.isConnected)svg.append(rect);
  }

  let paintTimer = null;
  function schedulePaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paint, 50);
  }
  clear.addEventListener("click", () => {
    editableFilters.forEach((filter, index) => { filter.values = [...defaults[index]]; });
    filters = filters.filter(filter => filter.source !== 'crossfilter');
    inspection = null;
    for (const binding of filterBindings) {
      if (binding.select) {
        [...binding.select.options].forEach(option => { option.selected = binding.filter.values.some(value => Object.is(value, JSON.parse(option.value))); });
      } else {
        binding.inputs.forEach((input, slot) => { input.value = binding.filter.values[slot] ?? ""; });
      }
    }
    paint();
  });

  window.addEventListener("beforeprint", paint);
  window.addEventListener("afterprint", paint);
  // Paint after layout so charts measure their real widths.
  requestAnimationFrame(paint);

  let timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(paint, 150);
  });
}

function paintEmpty(chartEl,message) {
  chartEl.replaceChildren();
  const box=document.createElement("div");box.className="export-tile-empty";box.setAttribute("role","status");box.textContent=message;
  chartEl.appendChild(box);
}

function paintError(chartEl, title, msg) {
  chartEl.innerHTML = "";
  const box = document.createElement("div");
  box.className = "export-tile-error";
  const head = document.createElement("div");
  head.className = "export-tile-error-title";
  head.textContent = title;
  box.appendChild(head);
  if (msg) {
    const m = document.createElement("div");
    m.className = "export-tile-error-msg";
    m.textContent = msg;
    box.appendChild(m);
  }
  chartEl.appendChild(box);
}
