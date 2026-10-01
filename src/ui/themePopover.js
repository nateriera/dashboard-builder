// Theme picker popover: lists the available visual themes with a small
// color preview each. Appended to document.body with fixed positioning.
// One popover open at a time (same conventions as the data popovers).

import { THEMES } from "../themes/themes.js";

let popEl = null;
let popAnchor = null;

export function closeThemePopover() {
  if (popEl) {
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
  if (!popEl.contains(e.target)) closeThemePopover();
}

function onDocKeyDown(e) {
  if (e.key === "Escape") closeThemePopover();
}

export function toggleThemePopover({ anchor, current, onSelect }) {
  if (popEl && popAnchor === anchor) {
    closeThemePopover();
    return;
  }
  closeThemePopover();
  openThemePopover({ anchor, current, onSelect });
}

function openThemePopover({ anchor, current, onSelect }) {
  const pop = document.createElement("div");
  pop.className = "data-popover theme-popover";

  const head = document.createElement("div");
  head.className = "data-pop-head";
  const title = document.createElement("strong");
  title.textContent = "Theme";
  const closeBtn = document.createElement("button");
  closeBtn.className = "data-pop-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close theme picker");
  closeBtn.addEventListener("click", closeThemePopover);
  head.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "data-panel";
  for (const theme of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-option" + (theme.id === current ? " current" : "");
    const swatches = theme.chart.categorical
      .slice(0, 4)
      .map(
        (c) =>
          `<span class="theme-swatch" style="background:${c}"></span>`
      )
      .join("");
    btn.innerHTML =
      `<span class="theme-preview" style="background:${theme.css["--paper"]};border-color:${theme.css["--slate-300"]}">` +
      `<span class="theme-preview-card" style="background:${theme.css["--white"]}"></span>` +
      `<span class="theme-preview-bar" style="background:${theme.chart.primary}"></span>` +
      `<span class="theme-preview-bar" style="background:${theme.chart.highlight}"></span>` +
      `</span>` +
      `<span class="theme-meta"><span class="theme-name">${theme.name}${
        theme.id === current ? " ✓" : ""
      }</span><span class="theme-blurb">${theme.blurb}</span></span>` +
      `<span class="theme-colors">${swatches}</span>`;
    btn.addEventListener("click", () => {
      onSelect(theme.id);
      closeThemePopover();
    });
    body.appendChild(btn);
  }
  const note = document.createElement("p");
  note.className = "data-sql-note";
  note.textContent = "The theme applies to the composer and is baked into HTML exports.";
  body.appendChild(note);

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
  popAnchor = anchor;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown);
}
