import { focusDialog } from "./focus.js";
import { anchorPopover } from "./anchoredPopover.js";
import { createPreviewGate } from "../data/queryCoordinator.js";
import { datasetVersion, listDatasets, subscribeDatasetChanges } from "../data/store.js";
// Tile "Data" popover: three tabs — Samples (bundled datasets), Upload
// (CSV/JSON file with column mapping), and SQL (DuckDB-WASM queries over all
// registered tables). Appended to document.body with fixed positioning so
// tile overflow never clips it. One popover open at a time.

import {
  TILE_TYPES,
  DATASET_LABELS,
  guessMapping,
  normalizeRows
} from "../tiles/registry.js";
import { readUpload } from "../data/readUpload.js";
import { fetchCsvText, parsePastedTable } from "../data/importSource.js";
import { parseFile } from "../data/parse.js";
import { saveDataset, persistDataset, uploadId, isUploadRef } from "../data/store.js";
import { saveQuery, getQuery } from "../data/queries.js";
import { substituteParameters } from "../data/parameters.js";
import {
  starterQuery,
  sampleTableName,
  uploadTableName,
  isQueryRef
} from "../data/sql.js";

let releaseRevision = null;
let releaseFocus = null;
let releasePosition = null;
let popEl = null;
let popAnchor = null;

export function closeDataPopover() {
  if (popEl) {
    releasePosition?.(); releasePosition = null;
    releaseRevision?.(); releaseRevision = null;
    releaseFocus?.(); releaseFocus = null;
    popEl.remove();
    popEl = null;
    popAnchor = null;
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown);
  }
}

function onDocPointerDown(e) {
  if (!popEl) return;
  // Anchor clicks are handled by the toggle in the button's own handler.
  if (popAnchor && popAnchor.contains(e.target)) return;
  if (!popEl.contains(e.target)) closeDataPopover();
}

function onDocKeyDown(e) {
  if (e.key === "Escape") closeDataPopover();
}

export function toggleDataPopover({ anchor, type, meta, dashboard, onSample, onUpload, onQuery, onDashboard, getParameters = () => [] }) {
  if (popEl && popAnchor === anchor) {
    closeDataPopover();
    return;
  }
  closeDataPopover();
  openDataPopover({ anchor, type, meta, dashboard, onSample, onUpload, onQuery, onDashboard, getParameters });
}

function openDataPopover({ anchor, type, meta, dashboard, onSample, onUpload, onQuery, onDashboard, getParameters }) {
  const entry = TILE_TYPES[type];
  if (!entry) return;

  const pop = document.createElement("div");
  pop.className = "data-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Tile data");

  // ── Header ──
  const head = document.createElement("div");
  head.className = "data-pop-head";
  const title = document.createElement("span");
  title.textContent = "Tile data";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "data-pop-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", closeDataPopover);
  head.append(title, closeBtn);

  // ── Tabs ──
  const tabs = document.createElement("div");
  tabs.className = "data-tabs";
  const tabSamples = document.createElement("button");
  tabSamples.type = "button";
  tabSamples.className = "data-tab active";
  tabSamples.textContent = "Samples";
  const tabUpload = document.createElement("button");
  tabUpload.type = "button";
  tabUpload.className = "data-tab";
  tabUpload.textContent = "Upload";
  const tabSql = document.createElement("button");
  tabSql.type = "button";
  tabSql.className = "data-tab";
  tabSql.textContent = "SQL";
  tabs.append(tabSamples, tabUpload, tabSql);

  const panelSamples = document.createElement("div");
  panelSamples.className = "data-panel";
  const panelUpload = document.createElement("div");
  panelUpload.className = "data-panel";
  panelUpload.hidden = true;
  const panelSql = document.createElement("div");
  panelSql.className = "data-panel";
  panelSql.hidden = true;

  const tabDefs = [
    ["samples", tabSamples, panelSamples],
    ["upload", tabUpload, panelUpload],
    ["sql", tabSql, panelSql]
  ];
  function showTab(which) {
    for (const [key, tab, panel] of tabDefs) {
      const active = key === which;
      tab.classList.toggle("active", active);
      panel.hidden = !active;
    }
    if (which === "sql") ensureSqlReady();
  }
  tabSamples.addEventListener("click", () => showTab("samples"));
  tabUpload.addEventListener("click", () => showTab("upload"));
  tabSql.addEventListener("click", () => showTab("sql"));

  // ── Samples panel: the bundled datasets this tile type can render ──
  // First option: follow the dashboard-wide default dataset (may be a CSV
  // dropped for all charts). Picking anything below overrides per tile.
  if (dashboard && typeof onDashboard === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "data-sample-btn" + (meta.dataset == null ? " current" : "");
    btn.textContent = `Dashboard default (${dashboard.name})`;
    btn.addEventListener("click", () => {
      onDashboard();
      closeDataPopover();
    });
    panelSamples.appendChild(btn);
  }
  for (const key of entry.datasets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "data-sample-btn" + (meta.dataset === key ? " current" : "");
    btn.textContent = DATASET_LABELS[key] || key;
    btn.addEventListener("click", () => {
      onSample(key);
      closeDataPopover();
    });
    panelSamples.appendChild(btn);
  }

  // ── Upload panel ──
  const state = {
    fileName: null,
    columns: null,
    rawRows: null,
    mapping: {}
  };

  const dropLabel = document.createElement("label");
  dropLabel.className = "data-drop";
  const dropText = document.createElement("span");
  dropText.textContent = "Choose a CSV or JSON file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.json,text/csv,application/json";
  fileInput.hidden = true;
  dropLabel.append(dropText, fileInput);

  const fileNameEl = document.createElement("div");
  fileNameEl.className = "data-filename";
  fileNameEl.hidden = true;

  const errorEl = document.createElement("div");
  errorEl.className = "data-error";
  errorEl.hidden = true;

  const mapWrap = document.createElement("div");
  mapWrap.className = "data-mapping";
  mapWrap.hidden = true;

  const previewWrap = document.createElement("div");
  previewWrap.className = "data-preview-wrap";
  previewWrap.hidden = true;
  const previewNote = document.createElement("div");
  previewNote.className = "data-preview-note";
  const previewTable = document.createElement("table");
  previewTable.className = "data-preview";
  previewWrap.append(previewNote, previewTable);

  const actions = document.createElement("div");
  actions.className = "data-actions";
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "data-apply";
  applyBtn.textContent = "Apply to tile";
  applyBtn.disabled = true;
  actions.appendChild(applyBtn);

  const sourceUrl = document.createElement("input");
  sourceUrl.type = "url";
  sourceUrl.placeholder = "https://example.com/data.csv";
  sourceUrl.setAttribute("aria-label", "Public CSV URL");
  const urlButton = document.createElement("button");
  urlButton.type = "button";
  urlButton.className = "data-import-source-button";
  urlButton.textContent = "Load CSV URL";
  const pasteArea = document.createElement("textarea");
  pasteArea.placeholder = "Paste spreadsheet cells here (tab-separated)";
  pasteArea.setAttribute("aria-label", "Paste tabular data");
  const pasteButton = document.createElement("button");
  pasteButton.type = "button";
  pasteButton.className = "data-import-source-button";
  pasteButton.textContent = "Preview pasted data";
  const sourceStatus = document.createElement("div");
  sourceStatus.className = "data-import-status";
  sourceStatus.setAttribute("role", "status");
  panelUpload.append(dropLabel, sourceUrl, urlButton, pasteArea, pasteButton, sourceStatus, fileNameEl, errorEl, mapWrap, previewWrap, actions);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    mapWrap.hidden = true;
    previewWrap.hidden = true;
    applyBtn.disabled = true;
  }

  function buildMappingUI() {
    mapWrap.innerHTML = "";
    if (entry.dynamicFields) {
      const note=document.createElement('p');note.textContent='All source columns are kept in their original order and cell types.';mapWrap.append(note);mapWrap.hidden=false;return;
    }
    for (const f of entry.fields) {
      const row = document.createElement("div");
      row.className = "data-field-row";
      const lab = document.createElement("span");
      lab.className = "data-field-label";
      lab.textContent = f.label;
      if (f.numeric) {
        const tag = document.createElement("em");
        tag.textContent = "numbers";
        lab.append(" ", tag);
      }
      if (f.optional) {
        const tag = document.createElement("em");
        tag.textContent = "optional";
        lab.append(" ", tag);
      }
      const sel = document.createElement("select");
      sel.setAttribute("aria-label",f.label);
      sel.dataset.fieldKey = f.key;
      const none = document.createElement("option");
      none.value = "";
      none.textContent = f.optional ? "— not mapped —" : "— choose —";
      sel.appendChild(none);
      for (const c of state.columns) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
      sel.value = state.mapping[f.key] || "";
      sel.addEventListener("change", () => {
        if (sel.value) state.mapping[f.key] = sel.value;
        else delete state.mapping[f.key];
        updatePreview();
      });
      row.append(lab, sel);
      mapWrap.appendChild(row);
    }
    mapWrap.hidden = false;
  }

  function updatePreview() {
    const required = entry.fields.filter((f) => !f.optional);
    const missing = required.filter((f) => !state.mapping[f.key]);
    if (missing.length) {
      previewWrap.hidden = true;
      applyBtn.disabled = true;
      return;
    }
    let rows, dropped;
    try { ({ rows, dropped } = normalizeRows(entry, state.rawRows, state.mapping)); }
    catch (err) { showError(err.message); state.normalized = null; return; }
    state.normalized = rows;

    previewTable.innerHTML = "";
    const mappedKeys = entry.dynamicFields ? state.columns : entry.fields.filter((f) => state.mapping[f.key]).map((f) => f.key);
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const k of mappedKeys) {
      const th = document.createElement("th");
      th.textContent = k;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    for (const r of rows.slice(0, 3)) {
      const tr = document.createElement("tr");
      for (const k of mappedKeys) {
        const td = document.createElement("td");
        let v = r[k];
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        td.textContent = v == null ? "—" : String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    previewTable.append(thead, tbody);

    previewNote.textContent =
      `${rows.length.toLocaleString()} rows` +
      (dropped ? ` · ${dropped.toLocaleString()} non-numeric value${dropped === 1 ? "" : "s"} blanked` : "") +
      " · showing first 3";
    previewWrap.hidden = false;
    applyBtn.disabled = false;
  }

  function acceptParsed(name, { columns, rows }) {
    state.fileName = name;
    state.columns = columns;
    state.rawRows = rows;
    state.mapping = guessMapping(entry, columns);
    fileNameEl.textContent = `${name} — ${rows.length.toLocaleString()} rows, ${columns.length} columns`;
    fileNameEl.hidden = false;
    errorEl.hidden = true;
    buildMappingUI();
    updatePreview();
  }

  urlButton.addEventListener("click", async () => {
    urlButton.disabled = true;
    sourceStatus.textContent = "Fetching public CSV…";
    errorEl.hidden = true;
    try {
      const text = await fetchCsvText(sourceUrl.value);
      if (!pop.isConnected) return;
      acceptParsed("URL CSV", parseFile("data.csv", text));
      sourceStatus.textContent = "CSV loaded. Review the preview, then apply it to this tile.";
    } catch (err) {
      sourceStatus.textContent = "";
      showError(err.message);
    } finally { urlButton.disabled = false; }
  });

  pasteButton.addEventListener("click", async () => {
    pasteButton.disabled = true;
    sourceStatus.textContent = "Validating pasted table…";
    errorEl.hidden = true;
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      acceptParsed("Pasted table", parsePastedTable(pasteArea.value));
      sourceStatus.textContent = "Pasted table ready. Review the preview, then apply it to this tile.";
    } catch (err) {
      sourceStatus.textContent = "";
      showError(err.message);
    } finally { pasteButton.disabled = false; }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errorEl.hidden = true;
    try {
      const { columns, rows } = await readUpload(file,pop);
      if (!pop.isConnected) return;
      acceptParsed(file.name, { columns, rows });
    } catch (err) {
      state.fileName = null;
      state.columns = null;
      state.rawRows = null;
      fileNameEl.hidden = true;
      showError(err.message);
    }
    fileInput.value = "";
  });

  applyBtn.addEventListener("click", async () => {
    if (!state.normalized || !state.fileName) return;
    const { id } = saveDataset({
      name: state.fileName,
      columns: state.columns,
      rows: state.normalized,
      fieldKeys: entry.dynamicFields ? [...state.columns] : entry.fields.map((f) => f.key),
      mapping: { ...state.mapping },
      // Keep the pre-normalization parse too: the dashboard-wide default
      // and the SQL tables work from the file's original columns.
      raw: { columns: state.columns, rows: state.rawRows }
    });
    const persisted = await persistDataset(id);
    onUpload({ id, name: state.fileName, persisted });
    closeDataPopover();
  });

  // ── SQL panel: DuckDB-WASM queries over every registered table ──
  // The duckdb module (and its .wasm) loads lazily on first use — the SQL
  // tab triggers it, as does the first query tile render.
  const qstate = { sql: null, columns: null, rows: null, mapping: {}, normalized: null };
  let sqlModule = null;
  let sqlReady = false;
  let sqlReadyPromise = null;
  let sqlRunning = false;

  const sqlTableWrap = document.createElement("div");
  sqlTableWrap.className = "data-sql-tables";
  const sqlTableNote = document.createElement("div");
  sqlTableNote.className = "data-sql-note";
  sqlTableNote.textContent = "Tables — click a name to insert it into the query:";
  const sqlTableList = document.createElement("div");
  sqlTableList.className = "data-sql-tablelist";
  sqlTableWrap.append(sqlTableNote, sqlTableList);

  const sqlInput = document.createElement("textarea");
  sqlInput.className = "data-sql-input";
  sqlInput.rows = 5;
  sqlInput.spellcheck = false;
  sqlInput.setAttribute("aria-label", "SQL query");
  // Seed the editor from the tile's CURRENT dataset, not the sample default:
  // a tile already bound to an upload queries its own table, and a query
  // tile reloads its saved SQL for editing. (Seeding always from the first
  // sample table made uploads feel ignored by the SQL tab.)
  function seedSqlInput() {
    if (isQueryRef(meta.dataset)) {
      const q = getQuery(meta.dataset.slice("query:".length));
      if (q && q.sql) {
        sqlInput.value = q.sql;
        return;
      }
    }
    if (isUploadRef(meta.dataset)) {
      sqlInput.value = starterQuery(uploadTableName(uploadId(meta.dataset)));
      return;
    }
    // A tile following the dashboard default queries the dashboard's table
    // when it has one (e.g. a dashboard-wide CSV); otherwise its sample.
    if (meta.dataset == null && dashboard && dashboard.table) {
      sqlInput.value = starterQuery(dashboard.table);
      return;
    }
    const key =
      meta.dataset && sampleTableName(meta.dataset) ? meta.dataset : entry.datasets[0];
    sqlInput.value = starterQuery(sampleTableName(key));
  }
  seedSqlInput();

  const sqlRunRow = document.createElement("div");
  sqlRunRow.className = "data-sql-runrow";
  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "data-sql-run";
  runBtn.textContent = "Run";
  runBtn.disabled = true;
  const sqlStatus = document.createElement("span");
  sqlStatus.className = "data-sql-status";
  sqlStatus.textContent = "Loading DuckDB…";
  const sqlRetryBtn = document.createElement("button");
  sqlRetryBtn.type = "button";
  sqlRetryBtn.className = "data-sql-retry";
  sqlRetryBtn.textContent = "Retry load";
  sqlRetryBtn.setAttribute("aria-label", "Retry loading the in-browser database");
  sqlRetryBtn.hidden = true;
  const cancelRun = document.createElement("button"); cancelRun.type = "button"; cancelRun.textContent = "Discard running result";
  cancelRun.onclick = () => { previewGate.invalidate(); qApplyBtn.disabled = true; sqlStatus.textContent = "Result discarded; wait for execution to finish before running again."; };
  sqlRunRow.append(runBtn, cancelRun, sqlStatus, sqlRetryBtn);

  const sqlError = document.createElement("div");
  sqlError.className = "data-error";
  sqlError.hidden = true;

  const qMapWrap = document.createElement("div");
  qMapWrap.className = "data-mapping";
  qMapWrap.hidden = true;

  const qPreviewWrap = document.createElement("div");
  qPreviewWrap.className = "data-preview-wrap";
  qPreviewWrap.hidden = true;
  const qPreviewNote = document.createElement("div");
  qPreviewNote.className = "data-preview-note";
  const qPreviewTable = document.createElement("table");
  qPreviewTable.className = "data-preview";
  qPreviewWrap.append(qPreviewNote, qPreviewTable);

  const qActions = document.createElement("div");
  qActions.className = "data-actions";
  const qApplyBtn = document.createElement("button");
  qApplyBtn.type = "button";
  qApplyBtn.className = "data-apply";
  qApplyBtn.textContent = "Apply to tile";
  qApplyBtn.disabled = true;
  qActions.appendChild(qApplyBtn);

  panelSql.append(sqlTableWrap, sqlInput, sqlRunRow, sqlError, qMapWrap, qPreviewWrap, qActions);

  function showSqlError(msg) {
    sqlError.textContent = msg;
    sqlError.hidden = false;
    qMapWrap.hidden = true;
    qPreviewWrap.hidden = true;
    qApplyBtn.disabled = true;
  }

  function buildTableList() {
    sqlTableList.innerHTML = "";
    for (const t of sqlModule.listTables()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "data-sql-table";
      chip.title = `${t.label} — click to insert into the query`;
      const code = document.createElement("code");
      code.textContent = t.name;
      const lab = document.createElement("span");
      lab.textContent = t.label;
      chip.append(code, document.createTextNode(" "), lab);
      chip.addEventListener("click", () => {
        const s = sqlInput.selectionStart ?? sqlInput.value.length;
        const e = sqlInput.selectionEnd ?? s;
        sqlInput.value = sqlInput.value.slice(0, s) + t.name + sqlInput.value.slice(e);
        sqlInput.focus();
        markSqlDirty();
      });
      sqlTableList.appendChild(chip);
    }
  }

  async function ensureSqlReady() {
    if (sqlReadyPromise) return sqlReadyPromise;

    const initialLoad = !sqlReady;
    sqlRetryBtn.hidden = true;
    sqlError.hidden = true;
    sqlError.textContent = "";
    if (initialLoad) {
      runBtn.disabled = true;
      sqlStatus.textContent = "Loading DuckDB…";
    }

    const slowTimer = initialLoad
      ? window.setTimeout(() => {
          sqlStatus.textContent = "Still loading the in-browser database (one-time ~39 MB download)…";
        }, 5000)
      : null;

    sqlReadyPromise = (async () => {
    try {
      if (!sqlModule) sqlModule = await import("../data/duckdb.js");
      await sqlModule.ensureTables();
      buildTableList(); // rebuild every time: uploads may have added tables
      sqlReady = true;
      runBtn.disabled = false;
      if (!sqlRunning) sqlStatus.textContent = "DuckDB ready";
      return true;
    } catch (err) {
      sqlReady = false;
      runBtn.disabled = true;
      sqlStatus.textContent = "DuckDB failed to load";
      sqlRetryBtn.hidden = false;
      showSqlError(err && err.message ? err.message : String(err));
      return false;
    } finally {
      if (slowTimer != null) window.clearTimeout(slowTimer);
      sqlReadyPromise = null;
    }
    })();
    return sqlReadyPromise;
  }

  sqlRetryBtn.addEventListener("click", () => { ensureSqlReady(); });

  const previewGate = createPreviewGate(datasetVersion);
  releaseRevision = subscribeDatasetChanges(() => { previewGate.invalidate(); qApplyBtn.disabled = true; sqlStatus.textContent = "Data changed — Run again"; });
  function markSqlDirty() {
    previewGate.invalidate();
    qApplyBtn.disabled = true;
    // The SQL changed after the last Run: Apply must not save stale results.
    if (qstate.sql != null && sqlInput.value !== qstate.sql) {
      qApplyBtn.disabled = true;
      if (!sqlRunning) sqlStatus.textContent = "Edited — Run again to apply";
    }
  }
  sqlInput.addEventListener("input", markSqlDirty);

  function buildQueryMappingUI() {
    qMapWrap.innerHTML = "";
    if (entry.dynamicFields) {
      const note=document.createElement('p');note.textContent='All query result columns are kept in their original order and cell types.';qMapWrap.append(note);qMapWrap.hidden=false;return;
    }
    for (const f of entry.fields) {
      const row = document.createElement("div");
      row.className = "data-field-row";
      const lab = document.createElement("span");
      lab.className = "data-field-label";
      lab.textContent = f.label;
      if (f.numeric) {
        const tag = document.createElement("em");
        tag.textContent = "numbers";
        lab.append(" ", tag);
      }
      if (f.optional) {
        const tag = document.createElement("em");
        tag.textContent = "optional";
        lab.append(" ", tag);
      }
      const sel = document.createElement("select");
      sel.dataset.fieldKey = f.key;
      const none = document.createElement("option");
      none.value = "";
      none.textContent = f.optional ? "— not mapped —" : "— choose —";
      sel.appendChild(none);
      for (const c of qstate.columns) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
      sel.value = qstate.mapping[f.key] || "";
      sel.addEventListener("change", () => {
        if (sel.value) qstate.mapping[f.key] = sel.value;
        else delete qstate.mapping[f.key];
        updateQueryPreview();
      });
      row.append(lab, sel);
      qMapWrap.appendChild(row);
    }
    qMapWrap.hidden = false;
  }

  function updateQueryPreview() {
    if (!previewGate.eligible(sqlInput.value) || sqlRunning) { qApplyBtn.disabled = true; return; }
    const required = entry.fields.filter((f) => !f.optional);
    const missing = required.filter((f) => !qstate.mapping[f.key]);
    if (missing.length) {
      qPreviewWrap.hidden = true;
      qApplyBtn.disabled = true;
      return;
    }
    let rows, dropped;
    try { ({ rows, dropped } = normalizeRows(entry, qstate.rows, qstate.mapping)); }
    catch (err) { showSqlError(err.message); previewGate.invalidate(); qstate.normalized = null; return; }
    qstate.normalized = rows;

    qPreviewTable.innerHTML = "";
    const mappedKeys = entry.dynamicFields ? qstate.columns : entry.fields.filter((f) => qstate.mapping[f.key]).map((f) => f.key);
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const k of mappedKeys) {
      const th = document.createElement("th");
      th.textContent = k;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    for (const r of rows.slice(0, 5)) {
      const tr = document.createElement("tr");
      for (const k of mappedKeys) {
        const td = document.createElement("td");
        let v = r[k];
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        td.textContent = v == null ? "—" : String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    qPreviewTable.append(thead, tbody);

    qPreviewNote.textContent =
      `${rows.length.toLocaleString()} rows` +
      (dropped ? ` · ${dropped.toLocaleString()} non-numeric value${dropped === 1 ? "" : "s"} blanked` : "") +
      " · showing first 5";
    qPreviewWrap.hidden = false;
    qApplyBtn.disabled = false;
  }

  runBtn.addEventListener("click", async () => {
    if (sqlRunning) return;
    const request = previewGate.begin(sqlInput.value);
    qApplyBtn.disabled = true;
    qstate.normalized = null;
    sqlRunning = true;
    runBtn.disabled = true;
    sqlError.hidden = true;
    sqlStatus.textContent = "Running…";
    try {
      const parameters=structuredClone(getParameters());
      const resolvedSql=substituteParameters(request.sql,parameters);
      const { columns, rows } = await sqlModule.runQuery(resolvedSql);
      if (!pop.isConnected || !previewGate.accept(request, sqlInput.value)) { sqlStatus.textContent = "Edited or data changed — Run again"; return; }
      qstate.sql = request.sql;
      qstate.columns = columns;
      qstate.rows = rows;
      qstate.mapping = guessMapping(entry, columns);
      sqlStatus.textContent = `${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`;
      buildQueryMappingUI();
      sqlRunning = false;
      updateQueryPreview();
    } catch (err) {
      previewGate.invalidate();
      qstate.normalized = null;
      qApplyBtn.disabled = true;
      qstate.sql = null;
      qstate.columns = null;
      qstate.rows = null;
      showSqlError(err && err.message ? err.message : String(err));
      sqlStatus.textContent = "Error";
    } finally {
      sqlRunning = false;
      runBtn.disabled = false;
    }
  });

  qApplyBtn.addEventListener("click", () => {
    if (!previewGate.eligible(sqlInput.value) || sqlRunning || !qstate.normalized || qstate.sql == null) { qApplyBtn.disabled = true; return; }
    const { id, name, persisted } = saveQuery({
      sql: qstate.sql,
      dependencies: listDatasets().map(ds => `upload:${ds.id}`),
      columns: qstate.columns,
      fieldKeys: entry.dynamicFields ? [...qstate.columns] : entry.fields.map((f) => f.key),
      mapping: { ...qstate.mapping }
    });
    onQuery({ id, name, persisted });
    closeDataPopover();
  });

  // If this tile already runs a query, land on the SQL tab.
  if (isQueryRef(meta.dataset)) showTab("sql");

  pop.append(head, tabs, panelSamples, panelUpload, panelSql);
  document.body.appendChild(pop);

  // Position under the anchor, clamped to the viewport.
  popEl = pop;
  releaseFocus = focusDialog(pop,anchor);
  popAnchor = anchor;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown);
  releasePosition = anchorPopover(pop, anchor);
}
