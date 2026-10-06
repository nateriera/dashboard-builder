import { focusDialog } from "./focus.js";
// Dashboard-wide default dataset popover: pick one CSV (or sample) that all
// charts follow, instead of binding data tile by tile. Tiles with an explicit
// per-tile dataset keep it; tiles on the default re-resolve on every render.
//
// Reuses the tile Data popover's CSS classes so it matches automatically.

import { DATASET_LABELS } from "../tiles/registry.js";
import { readUpload } from "../data/readUpload.js";
import { fetchCsvText, parsePastedTable } from "../data/importSource.js";
import { parseFile } from "../data/parse.js";
import { profileRows } from "../data/profile.js";
import { listDatasets } from "../data/store.js";

let releaseFocus = null;
let popEl = null;
let popAnchor = null;

export function closeDashboardPopover() {
  if (popEl) {
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
  if (popAnchor && popAnchor.contains(e.target)) return;
  if (!popEl.contains(e.target)) closeDashboardPopover();
}

function onDocKeyDown(e) {
  if (e.key === "Escape") closeDashboardPopover();
}

/**
 * @param current {kind:"samples"} | {kind:"dataset", ref} — the active default
 * @param sampleKeys string[] — sample dataset keys to offer
 * @param onSelect({kind, ref}) — user picked an existing dataset/default
 * @param onUpload({name, columns, rows, profile}) — user dropped a CSV/JSON (raw rows);
 *   the caller persists it and makes it the default
 */
export function toggleDashboardPopover({ anchor, current, sampleKeys, onSelect, onUpload }) {
  if (popEl && popAnchor === anchor) {
    closeDashboardPopover();
    return;
  }
  closeDashboardPopover();

  const pop = document.createElement("div");
  pop.className = "data-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Dashboard data");

  const head = document.createElement("div");
  head.className = "data-pop-head";
  const title = document.createElement("span");
  title.textContent = "Dashboard data";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "data-pop-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", closeDashboardPopover);
  head.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "data-panel";

  const note = document.createElement("div");
  note.className = "data-sql-note";
  note.textContent =
    "One dataset for every chart. Tiles with their own data keep it; new tiles follow this.";
  body.appendChild(note);

  const isCurrent = (kind, ref) =>
    current.kind === kind && (kind === "samples" || current.ref === ref);

  function optionBtn(label, selected, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "data-sample-btn" + (selected ? " current" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      onClick();
      closeDashboardPopover();
    });
    body.appendChild(btn);
    return btn;
  }

  optionBtn("Tile samples (each chart's own sample data)", isCurrent("samples"), () =>
    onSelect({ kind: "samples" })
  );

  const sub = document.createElement("div");
  sub.className = "data-sql-note";
  sub.textContent = "Samples";
  body.appendChild(sub);
  for (const key of sampleKeys) {
    optionBtn(DATASET_LABELS[key] || key, isCurrent("dataset", key), () =>
      onSelect({ kind: "dataset", ref: key })
    );
  }

  const uploads = listDatasets();
  if (uploads.length) {
    const sub2 = document.createElement("div");
    sub2.className = "data-sql-note";
    sub2.textContent = "Uploads";
    body.appendChild(sub2);
    for (const ds of uploads) {
      optionBtn(
        `${ds.name} — ${ds.rows.length.toLocaleString()} rows`,
        isCurrent("dataset", `upload:${ds.id}`),
        () => onSelect({ kind: "dataset", ref: `upload:${ds.id}` })
      );
    }
  }

  // ── Upload a new CSV/JSON as the dashboard dataset ──
  const dropLabel = document.createElement("label");
  dropLabel.className = "data-drop";
  const dropText = document.createElement("span");
  dropText.textContent = "Drop a CSV here, or click to choose a file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.json,text/csv,application/json";
  fileInput.hidden = true;
  dropLabel.append(dropText, fileInput);
  body.appendChild(dropLabel);

  const err = document.createElement("div");
  err.className = "data-error";
  err.hidden = true;
  body.appendChild(err);

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
  pasteButton.textContent = "Import pasted data";
  const sourceStatus = document.createElement("div");
  sourceStatus.className = "data-import-status";
  sourceStatus.setAttribute("role", "status");
  body.append(sourceUrl, urlButton, pasteArea, pasteButton, sourceStatus);

  async function handleFile(file) {
    err.hidden = true;
    dropText.textContent = `Reading ${file.name}…`;
    try {
      const { columns, rows, profile } = await readUpload(file,pop);
      if (!pop.isConnected) return;
      onUpload({ name: file.name, columns, rows, profile });
      closeDashboardPopover();
    } catch (e) {
      err.textContent = e && e.message ? e.message : String(e);
      err.hidden = false;
      dropText.textContent = "Drop a CSV here, or click to choose a file";
    }
    fileInput.value = "";
  }

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  urlButton.addEventListener("click", async () => {
    urlButton.disabled = true;
    err.hidden = true;
    sourceStatus.textContent = "Fetching public CSV…";
    try {
      const text = await fetchCsvText(sourceUrl.value);
      if (!pop.isConnected) return;
      const { columns, rows } = parseFile("data.csv", text);
      const profile = profileRows(columns, rows);
      onUpload({ name: "URL CSV", columns, rows, profile });
      closeDashboardPopover();
    } catch (e) {
      err.textContent = e?.message || String(e);
      err.hidden = false;
      sourceStatus.textContent = "";
    } finally { urlButton.disabled = false; }
  });

  pasteButton.addEventListener("click", () => {
    err.hidden = true;
    sourceStatus.textContent = "Validating pasted table…";
    try {
      const { columns, rows } = parsePastedTable(pasteArea.value);
      onUpload({ name: "Pasted table", columns, rows });
      closeDashboardPopover();
    } catch (e) {
      err.textContent = e?.message || String(e);
      err.hidden = false;
      sourceStatus.textContent = "";
    }
  });
  dropLabel.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropLabel.classList.add("dragging");
  });
  dropLabel.addEventListener("dragleave", () => dropLabel.classList.remove("dragging"));
  dropLabel.addEventListener("drop", (e) => {
    e.preventDefault();
    dropLabel.classList.remove("dragging");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  pop.append(head, body);
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const M = 8;
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - pw - M);
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - M) top = Math.max(M, r.top - ph - 6);
    pop.style.left = Math.max(M, left) + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "visible";
  });

  popEl = pop;
  releaseFocus = focusDialog(pop,anchor);
  popAnchor = anchor;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown);
}
