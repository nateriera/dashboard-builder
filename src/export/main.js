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
  if (editableFilters.length) root.appendChild(controls);

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
          const active = filters.find(filter => filter.source === "crossfilter" && filter.sourceTile === t.id);
          const incoming=mode==='highlight'?filters.filter(filter=>filter.source==='crossfilter'&&filter.sourceTile!==t.id&&filter.field===entry.crossfilterField):[];
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

  let paintTimer = null;
  function schedulePaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paint, 50);
  }
  clear.addEventListener("click", () => {
    editableFilters.forEach((filter, index) => { filter.values = [...defaults[index]]; });
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
