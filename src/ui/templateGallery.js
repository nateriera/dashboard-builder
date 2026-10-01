import { focusDialog } from "./focus.js";
// Template gallery: modal picker for starter templates and the user's own
// saved templates. Follows the dataPopover conventions (overlay + dialog,
// Escape/overlay-click to close, callbacks back into main.js).

import {
  BUILT_IN_TEMPLATES,
  loadUserTemplates,
  saveUserTemplate,
  deleteUserTemplate
} from "../templates.js";
import { TILE_TYPES } from "../tiles/registry.js";

let releaseFocus = null;
let overlayEl = null;
let docKeyHandler = null;

export function closeTemplateGallery() {
  releaseFocus?.(); releaseFocus = null;
  if (overlayEl) overlayEl.remove();
  overlayEl = null;
  if (docKeyHandler) {
    document.removeEventListener("keydown", docKeyHandler);
    docKeyHandler = null;
  }
}

export function openTemplateGallery({ applyTemplate, getCurrentTiles, getCurrentTheme, notify }) {
  // Toggle like the data popover.
  if (overlayEl) {
    closeTemplateGallery();
    return;
  }
  closeTemplateGallery();

  // card element -> { tpl, deletable } for the confirm/restore flows below.
  const cardInfo = new Map();

  const overlay = document.createElement("div");
  overlay.className = "tpl-overlay";
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeTemplateGallery();
  });

  const modal = document.createElement("div");
  modal.className = "tpl-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Dashboard templates");
  modal.tabIndex = -1;

  const head = document.createElement("div");
  head.className = "tpl-head";
  const title = document.createElement("h2");
  title.textContent = "Templates";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tpl-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close templates");
  closeBtn.addEventListener("click", closeTemplateGallery);
  head.append(title, closeBtn);

  const note = document.createElement("p");
  note.className = "tpl-note";
  note.textContent =
    "Starter templates are original compositions of common dashboard patterns. " +
    "Using one replaces your current dashboard.";

  const body = document.createElement("div");
  body.className = "tpl-body";

  const starterSection = buildSection("Starter templates");
  const starterGrid = document.createElement("div");
  starterGrid.className = "tpl-grid";
  for (const tpl of BUILT_IN_TEMPLATES) {
    starterGrid.appendChild(buildCard(tpl, false));
  }
  starterSection.appendChild(starterGrid);

  const userSection = buildSection("Your templates");
  const userGrid = document.createElement("div");
  userGrid.className = "tpl-grid";
  const emptyHint = document.createElement("p");
  emptyHint.className = "tpl-empty";
  emptyHint.textContent =
    "Nothing saved yet — arrange a dashboard you like and save it below.";
  userSection.append(userGrid, emptyHint);

  function refreshUserTemplates() {
    userGrid.innerHTML = "";
    cardInfo.forEach((info, card) => {
      if (info.deletable) cardInfo.delete(card);
    });
    const list = loadUserTemplates();
    emptyHint.hidden = list.length > 0;
    for (const tpl of list) userGrid.appendChild(buildCard(tpl, true));
  }
  refreshUserTemplates();

  // ── Save current ──────────────────────────────────────────────────────
  const saveRow = document.createElement("div");
  saveRow.className = "tpl-save-row";
  const saveLabel = document.createElement("span");
  saveLabel.className = "tpl-save-label";
  saveLabel.textContent = "Save current dashboard as a template:";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "tpl-name-input";
  nameInput.placeholder = "Template name";
  nameInput.maxLength = 60;
  nameInput.setAttribute("aria-label", "Template name");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "tpl-save-btn";
  saveBtn.textContent = "Save template";
  const doSave = () => {
    const tiles = getCurrentTiles();
    if (!tiles || tiles.length === 0) {
      notify("Nothing to save — the dashboard is empty.");
      return;
    }
    const tpl = saveUserTemplate(nameInput.value, tiles, getCurrentTheme());
    if (tpl) {
      nameInput.value = "";
      refreshUserTemplates();
      notify(`Saved template “${tpl.name}”.`);
    } else {
      notify("Couldn't save template — give it a name, or storage is unavailable.");
    }
  };
  saveBtn.addEventListener("click", doSave);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    // Let Escape reach the modal's closer; swallow the rest so nothing
    // behind the modal reacts to typing.
    if (e.key !== "Escape") e.stopPropagation();
  });
  saveRow.append(saveLabel, nameInput, saveBtn);

  body.append(starterSection, userSection, saveRow);
  modal.append(head, note, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlayEl = overlay;

  docKeyHandler = (e) => {
    if (e.key === "Escape") closeTemplateGallery();
  };
  document.addEventListener("keydown", docKeyHandler);
  releaseFocus = focusDialog(modal);

  // ── Card builders ─────────────────────────────────────────────────────
  function buildSection(heading) {
    const sec = document.createElement("section");
    sec.className = "tpl-section";
    const h = document.createElement("h3");
    h.textContent = heading;
    sec.appendChild(h);
    return sec;
  }

  function buildCard(tpl, deletable) {
    const card = document.createElement("div");
    card.className = "tpl-card";
    cardInfo.set(card, { tpl, deletable });

    card.appendChild(buildPreview(tpl.tiles));

    const name = document.createElement("div");
    name.className = "tpl-card-name";
    name.textContent = tpl.name;
    const desc = document.createElement("div");
    desc.className = "tpl-card-desc";
    desc.textContent = tpl.description || "";
    const meta = document.createElement("div");
    meta.className = "tpl-card-meta";
    meta.textContent = `${tpl.tiles.length} ${tpl.tiles.length === 1 ? "tile" : "tiles"}`;
    if (tpl.createdAt) {
      try {
        meta.textContent += ` · saved ${new Date(tpl.createdAt).toLocaleDateString()}`;
      } catch { /* ignore bad dates */ }
    }

    const actions = document.createElement("div");
    actions.className = "tpl-card-actions";
    card.append(name, desc, meta, actions);
    setDefaultActions(card);
    return card;
  }

  // Default card actions: [Use template] (+ [Delete] for user templates,
  // with its own two-step arm).
  function setDefaultActions(card) {
    const { tpl, deletable } = cardInfo.get(card);
    const actions = card.querySelector(".tpl-card-actions");
    delete actions.dataset.armed;
    actions.innerHTML = "";
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "tpl-use-btn";
    useBtn.textContent = "Use template";
    useBtn.addEventListener("click", () => armUseConfirm(card));
    actions.appendChild(useBtn);
    if (deletable) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tpl-del-btn";
      delBtn.textContent = "Delete";
      delBtn.title = "Delete this template";
      let armed = false;
      let timer = null;
      delBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          delBtn.textContent = "Sure?";
          delBtn.classList.add("armed");
          timer = setTimeout(() => {
            armed = false;
            delBtn.textContent = "Delete";
            delBtn.classList.remove("armed");
          }, 2500);
        } else {
          clearTimeout(timer);
          if (deleteUserTemplate(tpl.id)) {
            refreshUserTemplates();
            notify(`Deleted template “${tpl.name}”.`);
          } else {
            notify("Couldn't delete template — storage unavailable.");
          }
        }
      });
      actions.appendChild(delBtn);
    }
  }

  function disarmAllUseConfirms() {
    for (const [card] of cardInfo) {
      const actions = card.querySelector(".tpl-card-actions");
      if (actions && actions.dataset.armed === "1") setDefaultActions(card);
    }
  }

  // Two-step: first click arms "Replace current dashboard?", second applies.
  function armUseConfirm(card) {
    disarmAllUseConfirms();
    const { tpl } = cardInfo.get(card);
    const actions = card.querySelector(".tpl-card-actions");
    actions.dataset.armed = "1";
    actions.innerHTML = "";
    const q = document.createElement("span");
    q.className = "tpl-confirm-q";
    q.textContent = "Replace current dashboard?";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "tpl-confirm-yes";
    yes.textContent = "Replace";
    yes.addEventListener("click", () => {
      closeTemplateGallery();
      applyTemplate(tpl);
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "tpl-confirm-no";
    no.textContent = "Cancel";
    no.addEventListener("click", () => setDefaultActions(card));
    actions.append(q, yes, no);
    yes.focus();
  }
}

// Miniature 12-column schematic of the template layout.
function buildPreview(tiles) {
  const ROW_H = 13;
  const prev = document.createElement("div");
  prev.className = "tpl-preview";
  prev.setAttribute("aria-hidden", "true");
  let maxRow = 0;
  for (const t of tiles) maxRow = Math.max(maxRow, t.y + t.h);
  prev.style.height = `${maxRow * ROW_H + 8}px`;
  for (const t of tiles) {
    const entry = TILE_TYPES[t.type];
    const b = document.createElement("div");
    b.className = "tpl-block";
    b.style.left = `${(t.x / 12) * 100}%`;
    b.style.width = `calc(${(t.w / 12) * 100}% - 3px)`;
    b.style.top = `${t.y * ROW_H + 4}px`;
    b.style.height = `${Math.max(10, t.h * ROW_H - 4)}px`;
    const lab = document.createElement("span");
    lab.textContent = entry ? entry.label : t.type;
    b.appendChild(lab);
    prev.appendChild(b);
  }
  return prev;
}
