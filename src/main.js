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
import { TILE_TYPES, DATASETS, DATASET_LABELS } from "./tiles/registry.js";
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

// The chart kit's component CSS (cards, headers, KPIs, legends), injected
// once. It styles itself through theme CSS variables (see src/themes/).
document.head.appendChild(chartStyles);

// Apply the persisted theme before anything renders.
setTheme(getThemeId());

const STORAGE_KEY = "dashboard-builder:layout:v1";
// Build stamp, shown in the status bar on boot. Bump on every shipped archive
// so it's always possible to confirm which code is actually running.
const BUILD = "2f";
const gridEl = document.querySelector(".grid-stack");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Grid ─────────────────────────────────────────────────────────────────
const grid = GridStack.init(
  {
    column: 12,
    cellHeight: 72,
    margin: 12,
    // Drag tiles by their toolbar so chart tooltips/legends stay clickable.
    draggable: { handle: ".tile-toolbar" },
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

function dashboardDefaultName() {
  const dd = dashboardDefault;
  if (!dd || dd.kind === "samples") return "Tile samples";
  if (isUploadRef(dd.ref)) {
    const ds = getDataset(uploadId(dd.ref));
    return ds ? ds.name : "Missing upload";
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
    if (isUploadRef(dd.ref) && hasDataset(uploadId(dd.ref))) {
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
  return normalizeRows(entry, raw.rows, mapping).rows;
}

// Resolve a tile's render-ready (normalized) rows for static export.
// Mirrors renderTile/renderQueryTile's data logic; returns {rows} or {error}
// without touching the DOM or mutating tile metadata.
async function resolveExportRows(meta, entry) {
  if (isQueryRef(meta.dataset)) {
    const qid = queryId(meta.dataset);
    const q = getQuery(qid);
    if (!q) return { error: "Saved query is missing." };
    try {
      const { getCachedRows, runTileQuery } = await import("./data/duckdb.js");
      const rows = getCachedRows(qid) || (await runTileQuery(qid, q, entry));
      return { rows };
    } catch (err) {
      return { error: `Query failed: ${err && err.message ? err.message : err}` };
    }
  }
  if (meta.dataset == null) {
    const rows = resolveDashboardRows(entry);
    return rows
      ? { rows }
      : { error: `Dashboard data (“${dashboardDefaultName()}”) can't be used for this chart type.` };
  }
  if (isUploadRef(meta.dataset)) {
    const ds = getDataset(uploadId(meta.dataset));
    return ds ? { rows: ds.rows } : { error: "Uploaded dataset is missing." };
  }
  const rows = DATASETS[meta.dataset];
  return rows ? { rows } : { error: "Sample dataset is missing." };
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
  titleInput.value = meta.title;
  titleInput.spellcheck = false;
  titleInput.setAttribute("aria-label", "Tile title");
  // 'change' (not 'input') so re-rendering the chart below doesn't steal focus.
  titleInput.addEventListener("change", () => {
    meta.title = titleInput.value;
    renderTileById(meta.id);
    scheduleAutosave();
  });

  // ── Data button: opens the Samples/Upload popover ──
  const dataBtn = document.createElement("button");
  dataBtn.type = "button";
  dataBtn.className = "tile-data-btn";
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
        refreshQueryTiles(); // new tables: re-run any query tiles
      },
      onQuery: ({ id, name }) => {
        meta.dataset = `query:${id}`;
        meta.source = name;
        pruneQueries([...tileMeta.values()].map((m) => m.dataset));
        refreshDataLabel();
        renderTileById(meta.id);
        scheduleAutosave();
        setStatus(`SQL query applied — ${name}`);
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
  });

  toolbar.append(titleInput, dataBtn);

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
      toolbar.append(label);
    }
  }
  toolbar.append(removeBtn);

  const chart = document.createElement("div");
  chart.className = "tile-chart";

  tile.append(toolbar, chart);
  return tile;
}

// Add a tile of `type` to the grid. Omit x/y for auto-placement.
function addTile(type, { id, x, y, w, h, title, source, dataset, tileOptions } = {}) {
  const entry = TILE_TYPES[type];
  if (!entry) return null;

  const widgetId = id || `tile-${Date.now().toString(36)}-${tileSeq++}`;
  const meta = {
    id: widgetId,
    type,
    title: title ?? entry.defaultTitle,
    source: source ?? "Sample data",
    // New tiles follow the dashboard-wide default (null); explicit refs are
    // per-tile overrides. Undefined (very old layouts) also follows.
    dataset: dataset === undefined ? null : dataset,
    tileOptions: { ...(tileOptions || {}) }
  };
  // A layout may reference an upload that isn't in this browser (imported
  // file without inlined data, or cleared storage): revert to samples.
  // Same for a saved query that isn't here.
  if (isUploadRef(meta.dataset) && !hasDataset(uploadId(meta.dataset))) {
    meta.dataset = entry.defaultDataset;
    meta.source = "Sample data";
  }
  if (isQueryRef(meta.dataset) && !hasQuery(queryId(meta.dataset))) {
    meta.dataset = entry.defaultDataset;
    meta.source = "Sample data";
  }
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

  // Measure after layout so the chart renders at the tile's real width.
  requestAnimationFrame(() => renderTile(el));
  return el;
}

// Resolve a tile's data: bundled sample, previously-uploaded dataset, or the
// dashboard-wide default when the tile follows it (meta.dataset == null).
function resolveTileData(meta, entry) {
  if (meta.dataset == null) return resolveDashboardRows(entry);
  if (isUploadRef(meta.dataset)) {
    const ds = getDataset(uploadId(meta.dataset));
    return ds ? ds.rows : null;
  }
  return DATASETS[meta.dataset] || null;
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

function renderTile(el) {
  const node = el.gridstackNode;
  if (!node) return;
  const meta = tileMeta.get(node.id);
  if (!meta) return;
  const entry = TILE_TYPES[meta.type];
  const chartEl = el.querySelector(".tile-chart");
  if (!entry || !chartEl) return;

  if (isQueryRef(meta.dataset)) {
    renderQueryTile(el, meta, entry, chartEl);
    return;
  }

  let data = resolveTileData(meta, entry);
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
    // Uploaded dataset is gone (cleared storage, or an import that didn't
    // carry it): fall back to this tile type's sample dataset.
    meta.dataset = entry.defaultDataset;
    meta.source = "Sample data";
    data = DATASETS[meta.dataset];
    setStatus("An uploaded dataset was missing — tile reverted to sample data.");
    scheduleAutosave();
  }
  entry.render(chartEl, {
    data,
    options: { title: meta.title, source: meta.source, tileOptions: meta.tileOptions }
  });
}

// Query tiles resolve asynchronously: the DuckDB module (and its .wasm) loads
// lazily on first use. Cached results render synchronously; otherwise the tile
// shows a brief loading state while the query runs.
async function renderQueryTile(el, meta, entry, chartEl) {
  const qid = queryId(meta.dataset);
  const q = getQuery(qid);
  const capturedDataset = meta.dataset; // stale-render guard (see below)
  const options = () => ({
    title: meta.title,
    source: meta.source,
    tileOptions: meta.tileOptions
  });

  if (!q) {
    // Saved query is gone (cleared storage, or an import that didn't carry
    // it): fall back to this tile type's sample dataset, like missing uploads.
    meta.dataset = entry.defaultDataset;
    meta.source = "Sample data";
    entry.render(chartEl, { data: DATASETS[meta.dataset], options: options() });
    setStatus("A saved query was missing — tile reverted to sample data.");
    scheduleAutosave();
    return;
  }

  const { getCachedRows, runTileQuery } = await import("./data/duckdb.js");
  const cached = getCachedRows(qid);
  if (cached) {
    entry.render(chartEl, { data: cached, options: options() });
    return;
  }

  chartEl.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "tile-loading";
  loading.textContent = "Running query…";
  chartEl.appendChild(loading);

  try {
    const rows = await runTileQuery(qid, q, entry);
    // The tile may have been removed, re-bound, or re-rendered while the
    // query was in flight — never paint a stale result.
    if (!el.isConnected || tileMeta.get(meta.id)?.dataset !== capturedDataset) return;
    entry.render(chartEl, { data: rows, options: options() });
  } catch (err) {
    if (!el.isConnected || tileMeta.get(meta.id)?.dataset !== capturedDataset) return;
    if (isMissingTableError(err)) {
      // The query names a table that isn't registered here (e.g. an import
      // whose upload wasn't inlined): graceful fallback, like missing uploads.
      meta.dataset = entry.defaultDataset;
      meta.source = "Sample data";
      entry.render(chartEl, { data: DATASETS[meta.dataset], options: options() });
      setStatus(`Query failed (${err.message}) — tile reverted to sample data.`);
      scheduleAutosave();
    } else {
      chartEl.innerHTML = "";
      const box = document.createElement("div");
      box.className = "tile-error";
      const head = document.createElement("div");
      head.className = "tile-error-title";
      head.textContent = "Query failed";
      const msg = document.createElement("div");
      msg.className = "tile-error-msg";
      msg.textContent = err && err.message ? err.message : String(err);
      box.append(head, msg);
      chartEl.appendChild(box);
    }
  }
}

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
  if (el) renderTile(el);
}

// ── Layout serialization ─────────────────────────────────────────────────
function serializeLayout() {
  return {
    app: "dashboard-builder",
    version: 1,
    savedAt: new Date().toISOString(),
    defaultDataset: dashboardDefault,
    theme: getThemeId(),
    tiles: grid.save(false).map((n) => {
      const meta = tileMeta.get(n.id) || {};
      return {
        id: n.id,
        type: meta.type,
        title: meta.title,
        source: meta.source,
        dataset: meta.dataset,
        tileOptions: meta.tileOptions,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h
      };
    })
  };
}

function validateLayout(data) {
  if (!data || typeof data !== "object") throw new Error("layout is not an object");
  if (!Array.isArray(data.tiles)) throw new Error('layout is missing the "tiles" array');
  for (const t of data.tiles) {
    if (!t || !TILE_TYPES[t.type]) throw new Error(`unknown tile type "${t && t.type}"`);
  }
}

let bulkLoading = false; // suppresses autosave while a layout is being loaded

function loadLayout(data) {
  validateLayout(data);
  bulkLoading = true;
  try {
    grid.removeAll();
    tileMeta.clear();
    dashboardDefault = validateDashboardDefault(data.defaultDataset);
    refreshDashboardButton();
    if (data.theme) {
      setTheme(data.theme);
      refreshThemeButton();
    }
    for (const t of data.tiles) {
      const e = TILE_TYPES[t.type];
      // 2b-era tiles that never customized their data follow the dashboard now.
      if (e && t.dataset === e.defaultDataset) t.dataset = null;
      addTile(t.type, t);
    }
  } finally {
    bulkLoading = false;
  }
}

// Apply a template: like loadLayout, but the template's explicit sample
// datasets are kept as-is (no 2b-era migration) and the dashboard-wide
// default is left untouched — a template should look like its preview.
function applyTemplate(tpl) {
  const tiles = Array.isArray(tpl.tiles) ? tpl.tiles : [];
  bulkLoading = true;
  try {
    grid.removeAll();
    tileMeta.clear();
    for (const t of tiles) {
      if (TILE_TYPES[t.type]) addTile(t.type, t);
    }
  } finally {
    bulkLoading = false;
  }
  scheduleAutosave();
  setStatus(`Applied template “${tpl.name}” — ${tiles.length} tiles.`);
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
grid.on("resizestop", (_event, el) => {
  // Defer the re-render past GridStack's synchronous mouseup processing.
  // GridStack removes its document-level move/up listeners only AFTER our
  // handler returns; if renderTile() threw inside that call stack, the
  // cleanup would be skipped and the resize would stay glued to the cursor
  // permanently (even Escape re-enters the same path). A rAF keeps our work
  // out of their cleanup chain entirely — the same pattern addTile() uses.
  requestAnimationFrame(() => {
    try {
      renderTile(el);
    } catch (err) {
      // Never let a render failure wedge the grid: surface it instead.
      console.error("Tile re-render failed after resize:", err);
      setStatus(
        `Couldn't re-render tile after resize: ${err && err.message ? err.message : String(err)}`
      );
    }
  });
}); // re-render at the new width
grid.on("change", () => scheduleAutosave());
grid.on("removed", (_event, items) => {
  for (const n of items) tileMeta.delete(n.id);
  scheduleAutosave();
});

// ── Palette: drag onto the grid (GridStack drag-in) or click to add ──────
const paletteEl = document.getElementById("palette-items");
const paletteItems = [];
for (const [type, entry] of Object.entries(TILE_TYPES)) {
  const item = document.createElement("div");
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
    addTile(type);
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
    addTile(type, { x, y });
    scheduleAutosave();
  }
});

// ── Header actions ───────────────────────────────────────────────────────
const btnData = document.getElementById("btn-data");
const btnTemplates = document.getElementById("btn-templates");
const btnTheme = document.getElementById("btn-theme");
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
  gridEl.querySelectorAll(".grid-stack-item").forEach(renderTile);
}
function applyDashboardDefault(dd, statusMsg) {
  dashboardDefault = dd;
  refreshDashboardButton();
  refreshAllDataLabels();
  renderAllTiles();
  scheduleAutosave();
  if (statusMsg) setStatus(statusMsg);
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
      onUpload: async ({ name, columns, rows }) => {
        const { id } = saveDataset({
          name,
          columns,
          rows,
          fieldKeys: [],
          mapping: {},
          raw: { columns, rows }
        });
        const persisted = await persistDataset(id);
        refreshQueryTiles(); // new table for the SQL tab
        applyDashboardDefault(
          { kind: "dataset", ref: `upload:${id}` },
          persisted
            ? `Dashboard data: ${name}`
            : `Dashboard data: ${name} — browser storage unavailable, kept for this session only.`
        );
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

document.getElementById("btn-export").addEventListener("click", () => {
  const layout = serializeLayout();
  // Inline small uploaded datasets so the exported file is self-contained.
  // Includes the dashboard-wide default dataset, not just per-tile uploads.
  const refs = layout.tiles.map((t) => t.dataset).filter(isUploadRef);
  if (layout.defaultDataset?.kind === "dataset" && isUploadRef(layout.defaultDataset.ref)) {
    refs.push(layout.defaultDataset.ref);
  }
  const { inlined, skipped } = inlineDatasets(refs);
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
      const { rows, error } = await resolveExportRows(meta, entry);
      tiles.push({
        type: meta.type,
        title: meta.title,
        source: meta.source,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        tileOptions: meta.tileOptions || {},
        rows: rows || null,
        error: error || null
      });
    }

    const payload = {
      app: "dashboard-builder",
      version: 1,
      kind: "dashboard-export",
      title: "Dashboard",
      exportedAt: new Date().toISOString(),
      theme: getThemeId(),
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
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const restored = await restoreDatasets(data.datasets);
      const restoredQueries = restoreQueries(data.queries);
      loadLayout(data);
      pruneQueries([...tileMeta.values()].map((m) => m.dataset));
      refreshQueryTiles(); // imported tables/queries: (re-)run query tiles
      scheduleAutosave();
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
    closeDataPopover();
    closeDashboardPopover();
    closeThemePopover();
  }
  // Charts keep their rendered width; re-render in case chrome changes it.
  requestAnimationFrame(() =>
    gridEl.querySelectorAll(".grid-stack-item").forEach(renderTile)
  );
}

btnPresent.addEventListener("click", () => setPresent(true));
btnExitPresent.addEventListener("click", () => setPresent(false));

// ── Startup: restore autosaved layout, else a starter dashboard ──────────
function starterLayout() {
  return {
    app: "dashboard-builder",
    version: 1,
    tiles: [
      { type: "kpi", title: "Headlines", dataset: "kpis" },
      { type: "bar", title: "Requests by category", dataset: "categorical" },
      { type: "line", title: "Monthly requests", dataset: "timeseries" },
      { type: "donut", title: "Share of requests", dataset: "categorical", w: 4 },
      { type: "scatter", title: "Rent burden vs. homelessness rate", dataset: "scatter", w: 8 }
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
  setStatus(`${statusEl.textContent} · build ${BUILD}`);
})();
