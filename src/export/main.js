// Static export viewer: renders an exported dashboard payload with the same
// themed chart components as the composer. The payload is embedded in
// <script id="dashboard-data" type="application/json"> by the exporter.
// No network, no editor chrome — charts re-render on window resize.

import "./style.css";
import { TILE_TYPES } from "../tiles/registry.js";
import { chartStyles } from "../charts/charts.js";
import { previewTheme } from "../themes/themes.js";

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
      if (t.rows) {
        try {
          entry.render(chartEl, {
            data: t.rows,
            options: {
              title: t.title,
              source: t.source,
              tileOptions: t.tileOptions || {}, sizing: window.matchMedia('print').matches ? 'auto' : 'manual'
            }
          });
        } catch (err) {
          // Surface the real message: an export failure should name its cause.
          paintError(chartEl, "Couldn't render this chart.", err && err.message ? err.message : String(err));
        }
      } else {
        paintError(chartEl, "Data unavailable", t.error || "");
      }
    }
  };

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
