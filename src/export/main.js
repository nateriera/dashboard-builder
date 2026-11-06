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
import { retainSourceRows } from '../data/rowProvenance.js';
import { timeBrushPoints, timeBrushSelection } from '../charts/timeMarks.js';
import { exportMetaFacts, exportFactLines, tileSourceLine, formatExportStamp, filterAppliesToPage, crossfilterShownOnPage, packTileRows, describeFilterValue, printFilterSummary, viewerStateEquals, relativePresetLabel } from './viewerModel.js';

document.head.appendChild(chartStyles);

function readPayload() {
  try {
    const el = document.getElementById("dashboard-data");
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    if (!data || !Array.isArray(data.tiles)) return null;
    for (const tile of data.tiles) if (Array.isArray(tile.rows)) retainSourceRows(tile.rows, tile.sourceRows);
    return data;
  } catch {
    return null;
  }
}

const payload = readPayload();
const root = document.getElementById("export-root");
const crossfilterHref = mark => mark.getAttributeNS?.("http://www.w3.org/1999/xlink", "href") || mark.getAttribute?.("href") || "";
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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
  document.title = exportMetaFacts(payload.meta).title;
  renderExport(payload);
}

function renderExport(payload) {
  // Restore's "exported state". A saved view replaces it with that view's
  // state when applied (UX-7 D3); otherwise it is the state as exported.
  payload.viewerDefaults ||= {
    filters: clone(payload.filters || []),
    parameters: clone(payload.parameters || [])
  };
  root.innerHTML = "";
  const facts = exportMetaFacts(payload.meta);
  document.title = facts.title;
  const pages = Array.isArray(payload.pages) && payload.pages.length ? payload.pages : [{ id: 'page-1', name: 'Dashboard' }];
  const multiPage = pages.length > 1;
  const pageHeadingId = pageId => `page-${pageId}`;

  // ── V2: title block ──────────────────────────────────────────────────
  const head = el('header', 'export-head');
  head.append(el('span', 'export-badge', 'Offline snapshot'), el('h1', null, facts.title),
    ...exportFactLines(payload.meta).map(line => el('p', 'export-fact', line)));
  const stamp = payload.exportedAt
    ? formatExportStamp(payload.exportedAt, Number.isFinite(payload.exportedAtOffset) ? payload.exportedAtOffset : -new Date(payload.exportedAt).getTimezoneOffset())
    : null;
  if (stamp) head.append(el('p', 'export-meta', `Exported: ${stamp}`));
  head.append(el('p', 'export-note', 'This file contains the data included at export. It works offline and does not update automatically.'));
  const frozen = Array.isArray(payload.frozenParameters) ? payload.frozenParameters : [];
  if (frozen.length) {
    // Parameters track: SQL-referencing parameters are frozen in the export.
    const disclosure = el('section', 'export-freeze-notice');
    disclosure.setAttribute('aria-label', 'Snapshot and frozen SQL parameters');
    disclosure.append(el('p', null, `Data snapshot as of ${stamp || 'the recorded export time'}. SQL-referencing parameters are frozen at these exported values.`));
    const list = el('dl', 'export-frozen-parameters');
    for (const parameter of frozen) list.append(el('dt', null, parameter.name), el('dd', null, JSON.stringify(parameter.value) ?? 'undefined'));
    disclosure.append(list);
    head.append(disclosure);
  }
  root.appendChild(head);

  if (Array.isArray(payload.savedViews) && payload.savedViews.length) {
    const views = el('section', 'export-saved-views'); views.setAttribute('aria-label', 'Saved dashboard views');
    const label = el('label', null, 'Saved view');
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Saved dashboard view');
    const placeholder = el('option', null, 'Choose a view'); placeholder.value = ''; select.appendChild(placeholder);
    for (const view of payload.savedViews) { const option = el('option', null, view.disabled === true ? `${view.name} — Disabled: ${view.disabledReason}` : view.name); option.value = view.id; option.disabled = view.disabled === true; select.appendChild(option); }
    const apply = el('button', null, 'Apply view'); apply.type = 'button';
    apply.addEventListener('click', () => {
      const view = payload.savedViews.find(item => item.id === select.value); if (!view || view.disabled === true) return;
      payload.filters = clone(view.filters);
      const values = new Map((view.parameters || []).map(parameter => [parameter.name, parameter.value]));
      payload.parameters = (payload.parameters || []).map(parameter => values.has(parameter.name) ? { ...parameter, value: clone(values.get(parameter.name)) } : parameter);
      const frozenNames = new Set((payload.frozenParameters || []).map(parameter => parameter.name));
      for (const parameter of payload.parameters) {
        const binding = parameter.bindings?.find(item => item.kind === 'filter'); if (!binding || frozenNames.has(parameter.name)) continue;
        const filter = payload.filters.find(item => item.id === binding.filterId); if (!filter) continue;
        const value = parameter.value;
        if (parameter.type === 'number-range' || parameter.type === 'date-range') { if (value?.from != null && value?.to != null) filter.values = [value.from, value.to]; }
        else filter.values = parameter.type === 'multi-select' ? [...value] : [value];
      }
      // D3: the applied view's state becomes what Restore returns to.
      payload.viewerDefaults = { filters: clone(payload.filters), parameters: clone(payload.parameters) };
      payload.currentPageId = view.currentPageId; payload.theme = view.theme; previewTheme(view.theme); renderExport(payload);
    });
    label.appendChild(select); views.append(label, apply); root.appendChild(views);
  }

  // ── V4: anchor navigation (multi-page only) ──────────────────────────
  if (multiPage) {
    const nav = el('nav', 'export-page-tabs'); nav.setAttribute('aria-label', 'Dashboard pages');
    for (const page of pages) { const link = el('a', null, page.name); link.href = `#${pageHeadingId(page.id)}`; nav.append(link); }
    root.appendChild(nav);
  }

  // ── Shared filter state (one state, rendered per page group) ─────────
  let filters = (payload.filters || []).map(filter => ({ ...filter, values: [...filter.values] }));
  const editableFilters = filters.filter(filter => filter.source !== "crossfilter");
  const defaultFilters = new Map(payload.viewerDefaults.filters.map(filter => [filter.id, filter]));
  const defaults = new Map(editableFilters.map(filter => {
    const base = defaultFilters.get(filter.id) || filter;
    return [filter, { values: [...base.values], relativePreset: base.relativePreset }];
  }));
  const defaultCrossfilters = () => payload.viewerDefaults.filters.filter(filter => filter.source === 'crossfilter').map(filter => clone(filter));
  const parameters = Array.isArray(payload.parameters) ? payload.parameters : [];
  const frozenNames = new Set((payload.frozenParameters || []).map(parameter => parameter.name));
  const boundFilterIds = new Set(parameters.flatMap(parameter => parameter.bindings?.filter(item => item.kind === 'filter').map(item => item.filterId) || []));
  const liveBindings = new Map(parameters.filter(parameter => !frozenNames.has(parameter.name)).flatMap(parameter => {
    const binding = parameter.bindings?.find(item => item.kind === 'filter');
    return binding ? [[binding.filterId, parameter]] : [];
  }));
  const parameterDefaults = new Map(payload.viewerDefaults.parameters.map(parameter => [parameter.name, clone(parameter.value)]));
  const filterBindings = [];
  let inspection = null;
  const syncControls = except => { for (const binding of filterBindings) if (binding !== except) binding.sync(); };
  const filterField = filter => filter.targets?.[0]?.field || filter.field;

  function buildControl(filter) {
    const parameter = liveBindings.get(filter.id);
    const field = filterField(filter);
    const label = el('label', 'export-filter');
    label.appendChild(el('span', null, field));
    const binding = { filter };
    if (parameter) {
      label.classList.add('export-parameter-control');
      label.appendChild(el('span', null, parameter.name));
      const parameterControls = [];
      const rangeValues = value => value?.from == null || value?.to == null ? null : [value.from, value.to];
      const parameterValues = parameter.type === 'number-range' || parameter.type === 'date-range'
        ? rangeValues(parameter.value)
        : parameter.type === 'multi-select' ? [...(parameter.value || [])] : [parameter.value];
      const expected = parameter.type === 'multi-select' ? [...(parameterValues || [])].sort() : parameterValues;
      const actual = parameter.type === 'multi-select' ? [...filter.values].sort() : filter.values;
      const bindingConflict = !expected || expected.length !== actual.length || expected.some((value, index) => !Object.is(value, actual[index]));
      const warning = el('span', 'export-binding-conflict', `Binding conflict: ${parameter.name} and ${field} have different values.`); warning.setAttribute('role', 'alert'); warning.hidden = !bindingConflict; label.appendChild(warning);
      const updateWarning = () => {
        const current = parameter.type === 'number-range' || parameter.type === 'date-range' ? rangeValues(parameter.value) : parameter.type === 'multi-select' ? [...parameter.value].sort() : [parameter.value];
        if (!current) { warning.hidden = false; warning.textContent = `Binding conflict: ${parameter.name} needs both range bounds; ${field} was left unchanged.`; return; }
        const currentFilterValues = parameter.type === 'multi-select' ? [...filter.values].sort() : filter.values;
        warning.hidden = current.length === currentFilterValues.length && current.every((value, index) => Object.is(value, currentFilterValues[index]));
        warning.textContent = `Binding conflict: ${parameter.name} and ${field} have different values.`;
      };
      const setValue = value => {
        parameter.value = value;
        if (parameter.type === 'number-range' || parameter.type === 'date-range') {
          if (value?.from == null || value?.to == null) { warning.hidden = false; warning.textContent = `Binding conflict: ${parameter.name} needs both range bounds; ${field} was left unchanged.`; syncControls(binding); return; }
          filter.values = [value.from, value.to];
        } else filter.values = parameter.type === 'multi-select' ? [...value] : [value];
        updateWarning();
        syncControls(binding);
        schedulePaint();
      };
      const control = (tag, type, aria) => { const input = document.createElement(tag); if (type) input.type = type; input.setAttribute('aria-label', aria); label.appendChild(input); parameterControls.push(input); return input; };
      if (parameter.type === 'number-range' || parameter.type === 'date-range') {
        const date = parameter.type === 'date-range';
        for (const slot of ['from', 'to']) { const input = control('input', date ? 'date' : 'number', `${parameter.name} ${slot}`); if (!date) input.step = 'any'; input.addEventListener('input', () => setValue({ ...parameter.value, [slot]: input.value === '' ? null : date ? input.value : Number(input.value) })); }
      } else if (parameter.type === 'boolean') {
        const input = control('input', 'checkbox', parameter.name); input.addEventListener('change', () => setValue(input.checked));
      } else if (parameter.type === 'single-select' || parameter.type === 'multi-select') {
        const select = control('select', null, parameter.name); select.multiple = parameter.type === 'multi-select';
        const options = [...(parameter.options || [])], staleValues = new Set(parameter.staleValues || []); for (const stale of staleValues) if (!options.includes(stale)) options.push(stale);
        if (parameter.type === 'single-select' && !options.includes(parameter.value)) { options.push(parameter.value); staleValues.add(parameter.value); }
        for (const value of options) { const option = el('option', null, staleValues.has(value) ? `${value} (stale)` : value); option.value = value; select.appendChild(option); }
        select.addEventListener('change', () => setValue(parameter.type === 'single-select' ? select.value : [...select.selectedOptions].map(option => option.value)));
      } else {
        const input = control('input', parameter.type === 'number' ? 'number' : 'text', parameter.name);
        if (parameter.type === 'number') { if (parameter.min !== undefined) input.min = String(parameter.min); if (parameter.max !== undefined) input.max = String(parameter.max); input.step = parameter.integer ? String(parameter.step ?? 1) : parameter.step === undefined ? 'any' : String(parameter.step); }
        input.addEventListener('input', () => setValue(parameter.type === 'number' ? Number(input.value) : input.value));
      }
      binding.sync = () => {
        const value = parameter.value, type = parameter.type;
        if (type === 'boolean') parameterControls[0].checked = value === true;
        else if (type === 'single-select' || type === 'multi-select') [...parameterControls[0].options].forEach(option => option.selected = type === 'single-select' ? option.value === value : (value || []).includes(option.value));
        else if (type === 'number-range' || type === 'date-range') parameterControls.forEach((input, index) => input.value = value?.[index === 0 ? 'from' : 'to'] ?? '');
        else parameterControls[0].value = value ?? '';
      };
      binding.sync();
      binding.updateWarning = updateWarning;
      const sync = binding.sync;
      binding.sync = () => { sync(); updateWarning(); };
    } else if (filter.op === "between" || filter.op === "date-between") {
      const date = filter.op === "date-between";
      let presetControl = null;
      if (date && filter.relativePreset) {
        const preset = document.createElement("select");
        presetControl = preset;
        preset.setAttribute("aria-label", `${field} date range preset`);
        for (const value of ["last-7-days", "last-30-days", "month-to-date", "last-month", "year-to-date"]) {
          const option = el("option", null, relativePresetLabel(value)); option.value = value; preset.appendChild(option);
        }
        preset.addEventListener("change", () => { filter.relativePreset = preset.value; syncControls(binding); schedulePaint(); });
        label.appendChild(preset);
      }
      const inputs = [0, 1].map((slot) => {
        const input = document.createElement("input");
        input.type = date ? "date" : "number";
        if (!date) input.step = "any";
        input.setAttribute("aria-label", `${field} ${slot === 0 ? "minimum" : "maximum"}`);
        input.addEventListener("input", () => {
          if (date && presetControl) { filter.relativePreset = undefined; presetControl.value = ""; }
          const pair = inputs.map(item => item.value);
          if (pair.some(value => value === "")) filter.values = [];
          else {
            const parsed = pair.map(value => date ? value : Number(value));
            filter.values = parsed[0] <= parsed[1] ? parsed : [parsed[1], parsed[0]];
          }
          syncControls(binding);
          schedulePaint();
        });
        label.appendChild(input);
        return input;
      });
      binding.sync = () => {
        if (presetControl) presetControl.value = filter.relativePreset || "";
        inputs.forEach((input, slot) => { input.value = filter.values[slot] ?? ""; });
      };
      binding.sync();
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
        const option = el("option", null, value == null ? "(blank)" : String(value));
        option.value = JSON.stringify(value);
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        filter.values = [...select.selectedOptions].map(option => JSON.parse(option.value));
        syncControls(binding);
        schedulePaint();
      });
      label.appendChild(select);
      binding.sync = () => { [...select.options].forEach(option => { option.selected = filter.values.some(value => Object.is(value, JSON.parse(option.value))); }); };
      binding.sync();
    }
    filterBindings.push(binding);
    return label;
  }

  // ── Tiles, normalized onto known pages ──────────────────────────────
  const tiles = payload.tiles.filter(t => TILE_TYPES[t.type]).map(t => ({ ...t, pageId: pages.some(page => page.id === t.pageId) ? t.pageId : pages[0].id }));

  // ── V3/V4: one section per page, each with its applicable filter group ─
  const pageViews = pages.map(page => {
    const section = el('section', 'export-page'); section.dataset.pageId = page.id;
    if (multiPage) {
      const heading = el('h2', 'export-page-heading', page.name); heading.id = pageHeadingId(page.id); heading.tabIndex = -1;
      section.setAttribute('aria-labelledby', heading.id); section.append(heading);
    }
    const pageFilters = editableFilters.filter(filter => filterAppliesToPage(filter, page.id, tiles));
    const group = el('section', 'export-filters');
    group.setAttribute('aria-label', multiPage ? `Filters for ${page.name}` : 'Dashboard filters');
    group.append(el(multiPage ? 'h3' : 'h2', 'export-filters-heading', 'Filter this dashboard'), el('p', 'export-filters-caption', 'Changes affect this file only.'));
    if (pageFilters.length) { const controls = el('div', 'export-filter-controls'); for (const filter of pageFilters) controls.append(buildControl(filter)); group.append(controls); }
    const chips = el('div', 'export-crossfilters'); chips.setAttribute('aria-label', 'Chart selections');
    const restore = el('button', 'export-restore', 'Restore exported filters'); restore.type = 'button';
    restore.addEventListener('click', restoreExported);
    group.append(chips, restore);
    const summary = el('p', 'export-print-filters'); summary.hidden = true;
    section.append(summary);
    const pageTiles = tiles.filter(t => t.pageId === page.id).sort((a, b) => a.y - b.y || a.x - b.x);
    let grid = null;
    if (pageTiles.length) {
      grid = el('div', 'export-grid'); grid.dataset.pageId = page.id; section.append(grid);
    } else section.append(el('p', 'export-notice', 'This page contains no charts.'));
    root.appendChild(section);
    return { page, section, group, chips, restore, summary, pageFilters, pageTiles, grid };
  });

  const rendered = [];
  const brushStates = new WeakMap();
  for (const view of pageViews) {
    const placement = packTileRows(view.pageTiles);
    for (const t of view.pageTiles) {
      const entry = TILE_TYPES[t.type];
      const tile = el("section", "export-tile");
      tile.dataset.tileId = t.id || "";
      const { rowStart, rowEnd } = placement.get(t);
      tile.style.gridColumn = `${t.x + 1} / span ${t.w}`;
      tile.style.gridRow = `${rowStart} / ${rowEnd}`;
      const chartEl = el("div", "tile-chart");
      tile.appendChild(chartEl);
      view.grid.appendChild(tile);
      rendered.push({ t, entry, chartEl });
    }
  }

  const crossfilterLabel = filter => filter.op === 'date-between' ? `${filter.field} · ${filter.values[0]}–${filter.values[1]}` : `${filter.field} is ${filter.values.map(value => value == null ? '(blank)' : String(value)).join(', ')}`;

  const paint = () => {
    const activeCrossfilters = filters.filter(filter => filter.source === 'crossfilter');
    const atExport = viewerStateEquals({ filters, parameters }, payload.viewerDefaults);
    for (const view of pageViews) {
      const shown = activeCrossfilters.filter(filter => crossfilterShownOnPage(filter, view.page.id, tiles));
      view.chips.replaceChildren();
      view.chips.hidden = !shown.length;
      for (const filter of shown) {
        const source = payload.tiles.find(tile => tile.id === filter.sourceTile), button = el('button', 'export-crossfilter-chip', `${source?.title || 'Chart'}: ${crossfilterLabel(filter)} ×`);
        button.type = 'button';
        button.setAttribute('aria-label', `Clear ${source?.title || 'chart'} selection`);
        button.addEventListener('click', () => { filters = filters.filter(item => item !== filter); inspection = null; paint(); });
        view.chips.appendChild(button);
      }
      // V3: render the region only when it has something functional in it.
      if (view.pageFilters.length || shown.length) { if (!view.group.isConnected) view.section.insertBefore(view.group, view.summary); }
      else view.group.remove();
      view.restore.disabled = atExport;
      const summary = printFilterSummary([
        ...view.pageFilters.map(filter => ({ label: filterField(filter), value: describeFilterValue(filter) })),
        ...shown.map(filter => ({ label: payload.tiles.find(tile => tile.id === filter.sourceTile)?.title || 'Chart selection', value: crossfilterLabel(filter) }))
      ]);
      view.summary.textContent = summary || '';
      view.summary.hidden = !summary;
    }
    for (const { t, entry, chartEl } of rendered) {
      if (t.emptyMessage) {
        paintEmpty(chartEl, t, t.emptyMessage);
      } else if (t.rows) {
        try {
          const mode = t.tileOptions?.crossfilterMode || 'filter';
          const activeFilters = filters.filter(filter => (filter.values.length > 0 || filter.op === 'is' && boundFilterIds.has(filter.id)) && (filter.source !== 'crossfilter' || filter.sourceTile === t.id || mode === 'filter'));
          const filtered = applyFilters(t.rows, activeFilters, { sourceTile: t.id, pageId: t.pageId });
          const sortable = ['bar', 'column', 'dot', 'stackedBar', 'stackedColumn'].includes(t.type);
          const data = sortable && t.tileOptions?.topN != null
            ? sortAndLimitRows(t.type, filtered.rows, { sort: t.tileOptions?.sort ?? 'desc', topN: t.tileOptions.topN })
            : filtered.rows;
          if (filtered.applied && data.length === 0) { paintEmpty(chartEl, t, "No data matches these filters."); continue; }
          entry.render(chartEl, {
            data,
            options: {
              title: t.title,
              source: t.source,
              // V5: cards size to their content, never to the editor grid.
              tileOptions: t.tileOptions || {}, sizing: 'auto',
              crossfilterField: t.crossfilterField || null,
              preBinnedHistogram: t.preBinnedHistogram === true
            }
          });
          wireOfflineTimeBrush(chartEl, t, entry, filters);
          const active = filters.find(filter => filter.source === "crossfilter" && filter.sourceTile === t.id);
          const mappings = t.tileOptions?.crossfilterFieldMappings || {};
          const incoming = mode === 'highlight' ? filters.filter(filter => filter.source === 'crossfilter' && filter.sourceTile !== t.id && (mappings[filter.field] ?? (filter.field === entry.crossfilterField ? entry.crossfilterField : null)) === entry.crossfilterField) : [];
          for (const mark of chartEl.querySelectorAll("a")) {
            const href = crossfilterHref(mark);
            if (!href.startsWith("#db-crossfilter:")) continue;
            let values = [];
            try { values = JSON.parse(decodeURIComponent(href.slice("#db-crossfilter:".length))); } catch { /* invalid link is inert */ }
            const selected = (!active || values.some(value => active.values.some(item => Object.is(item, value)))) && incoming.every(filter => values.some(value => filter.values.some(item => Object.is(item, value))));
            if (active || incoming.length) mark.setAttribute("data-crossfilter-selected", String(selected));
            else mark.removeAttribute("data-crossfilter-selected");
            mark.setAttribute("aria-description", "Activate to filter other charts. Hold Control or Command while selecting to add or remove values.");
          }
          if (inspection?.tileId === t.id) {
            const sourceFilters = filters.filter(filter => filter.source !== 'crossfilter' || filter.sourceTile === t.id || mode === 'filter');
            const records = applyFilters(t.rows, sourceFilters, { sourceTile: t.id, pageId: t.pageId }).rows.filter(row => inspection.values.some(value => Object.is(row[entry.crossfilterField], value)));
            if (records.length) { const details = chartData(records, [...new Set(records.flatMap(row => Object.keys(row)))].map(key => ({ key })), `${t.title} — selected records`); details.classList.add('chart-drillthrough'); chartEl.append(details); details.open = true; }
          }
          decorateCard(chartEl, t);
        } catch (err) {
          // Surface the real message: an export failure should name its cause.
          paintError(chartEl, t, "Couldn't render this chart.", err && err.message ? err.message : String(err));
        }
      } else {
        paintError(chartEl, t, "Data unavailable", t.error || "");
      }
    }
  };

  // V4: a mark's configured destination page is reached by its anchor.
  function goToPage(pageId) {
    const heading = document.getElementById(pageHeadingId(pageId));
    if (!heading) return;
    try { location.hash = heading.id; } catch { /* sandboxed: fall back to scrolling */ }
    if (location.hash !== `#${heading.id}`) heading.scrollIntoView();
  }

  for (const { t, chartEl } of rendered) {
    wireOfflineBrushEvents(chartEl, t, () => filters, nextFilters => { filters = nextFilters; paint(); });
    chartEl.addEventListener("click", event => {
      const link = event.target.closest?.("a");
      if (!link || !crossfilterHref(link).startsWith("#db-crossfilter:") || !t.crossfilterField) return;
      let values;
      try { values = JSON.parse(decodeURIComponent(crossfilterHref(link).slice("#db-crossfilter:".length))); } catch { return; }
      if (!Array.isArray(values) || !values.length) return;
      event.preventDefault();
      const action = t.tileOptions?.clickAction || 'filter-and-inspect';
      const destination = t.tileOptions?.clickDestinationPageId;
      if (action === 'inspect-only' && !destination) {
        inspection = { tileId: t.id, values };
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
      inspection = action === 'filter-only' || !nextValues.length || destination ? null : { tileId: t.id, values };
      paint();
      if (destination && multiPage && pages.some(page => page.id === destination)) goToPage(destination);
    });
  }

  // V3: Restore returns every editable filter and parameter to the exported
  // (or applied view's) values and crossfilter selections to that state.
  function restoreExported() {
    for (const filter of editableFilters) {
      const base = defaults.get(filter);
      filter.values = [...base.values];
      if (base.relativePreset) filter.relativePreset = base.relativePreset; else delete filter.relativePreset;
    }
    for (const parameter of parameters) if (parameterDefaults.has(parameter.name)) parameter.value = clone(parameterDefaults.get(parameter.name));
    filters = [...editableFilters, ...defaultCrossfilters()];
    inspection = null;
    syncControls(null);
    paint();
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
    const state = brushStates.get(chartEl) || { tile, drag: null };
    brushStates.set(chartEl,state);
    chartEl.addEventListener('pointerdown',event=>{
      const svg=event.target.closest?.('svg[role="img"]');
      if(event.button!==0||!svg)return;
      const points=timeBrushPoints(svg);
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
      const selection=timeBrushSelection(drag.points,drag.startX,drag.currentX);
      if(!selection)return;
      const activeFilters=getFilters();
      const current=activeFilters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===tile.id&&filter.op==='date-between'&&filter.field==='date');
      const next=activeFilters.filter(filter=>filter!==current);
      next.push({id:current?.id||`cross-export-date-${Date.now().toString(36)}`,field:'date',op:'date-between',...selection,source:'crossfilter',sourceTile:tile.id});
      updateFilters(next);
    },true);
    chartEl.addEventListener('pointercancel',event=>{
      if(state.drag?.pointerId===event.pointerId){state.drag.svg.querySelector(':scope > rect.db-time-brush')?.remove();state.drag=null;}
    },true);
  }

  function wireOfflineTimeBrush(chartEl,t,entry,activeFilters){
    if(!['line','area'].includes(t.type)||!entry.fields?.some(field=>field.key==='date'))return;
    const state=brushStates.get(chartEl);if(!state)return;
    state.tile=t;
    const svg=chartEl.querySelector('svg[role="img"][viewBox]');
    const active=activeFilters.find(filter=>filter.source==='crossfilter'&&filter.sourceTile===t.id&&filter.field==='date'&&filter.op==='date-between');
    if(!svg||!active){svg?.querySelector(':scope > rect.db-time-brush')?.remove();return;}
    const points=timeBrushPoints(svg);
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

function paintEmpty(chartEl, t, message) {
  chartEl.replaceChildren(el("div", "export-tile-empty", message));
  chartEl.firstChild.setAttribute("role", "status");
  decorateCard(chartEl, t);
}

function paintError(chartEl, t, title, msg) {
  const box = el("div", "export-tile-error");
  box.appendChild(el("div", "export-tile-error-title", title));
  if (msg) box.appendChild(el("div", "export-tile-error-msg", msg));
  chartEl.replaceChildren(box);
  decorateCard(chartEl, t);
}

// V5: one white card per tile — h3 heading, visualization, then a footer
// inside the card with the source, any notes and the data disclosure.
function decorateCard(chartEl, t) {
  const dataDetails = [...chartEl.children].find(node => node.matches('details.chart-data') && !node.classList.contains('chart-drillthrough'));
  let card = chartEl.querySelector(':scope > .db-card');
  if (!card) {
    card = el('div', 'db-card');
    if (t.title) { const head = el('div', 'db-chart-head'); head.append(el('h3', 'db-chart-title', t.title)); card.append(head); }
    const body = el('div', 'db-chart-body');
    body.append(...[...chartEl.childNodes].filter(node => node !== dataDetails));
    card.append(body);
    chartEl.prepend(card);
  } else {
    const title = card.querySelector(':scope > .db-chart-head > .db-chart-title');
    if (title && title.tagName !== 'H3') title.replaceWith(el('h3', title.className, title.textContent));
    card.querySelector(':scope > .db-chart-source')?.remove();
    card.append(...[...chartEl.children].filter(node => node !== card && node !== dataDetails));
  }
  card.classList.add('export-card');
  const footer = el('div', 'export-card-footer');
  const source = tileSourceLine(t.source);
  if (source) footer.append(el('p', 'export-card-source', source));
  if (typeof t.notes === 'string' && t.notes.trim()) footer.append(el('p', 'export-card-notes', `Notes: ${t.notes.trim()}`));
  if (dataDetails) footer.append(dataDetails);
  // No source, notes or data table: leave no empty footer (and its rule) behind.
  if (footer.childNodes.length) card.append(footer);
}
