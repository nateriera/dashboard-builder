import { validateLayout } from "./data/layout.js";
// Template library: original dashboard compositions a user can start from.
//
// IP rule (standing): templates are original compositions built from generic
// BI layout patterns (KPI strip + trend + mix, geo snapshot, scorecard…).
// Study published dashboards for structural patterns only; never close
// recreations. If a template ever draws on a specific published dashboard,
// set its `inspiredBy` to { name, url } — attribution is credit, not
// permission, so ask the creator before anything close.
//
// A template is layout JSON:
//   { id, name, description, inspiredBy, tiles: [
//       { type, x, y, w, h, title, dataset, tileOptions? } ] }
// `dataset` is an explicit sample-dataset key so templates render
// deterministically no matter what the dashboard-wide default is.

import { TILE_TYPES } from "./tiles/registry.js";

export const BUILT_IN_TEMPLATES = [
  {
    id: "executive-overview",
    theme: "paper",
    name: "Executive overview",
    description: "KPI strip, monthly trend, and category mix — the classic leadership summary.",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 2, title: "Key figures", dataset: "kpis" },
      { type: "line", x: 0, y: 2, w: 8, h: 5, title: "Monthly requests", dataset: "timeseries" },
      { type: "donut", x: 8, y: 2, w: 4, h: 5, title: "Requests by share", dataset: "categorical" },
      { type: "bar", x: 0, y: 7, w: 6, h: 5, title: "Requests by category", dataset: "categorical" },
      { type: "column", x: 6, y: 7, w: 6, h: 5, title: "Monthly volume", dataset: "categorical" }
    ]
  },
  {
    id: "sales-performance",
    theme: "paper",
    name: "Sales performance",
    description: "How revenue breaks down and where it's heading.",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 2, title: "Sales KPIs", dataset: "kpis" },
      { type: "column", x: 0, y: 2, w: 7, h: 5, title: "Revenue by category", dataset: "categorical" },
      { type: "donut", x: 7, y: 2, w: 5, h: 5, title: "Revenue share", dataset: "categorical" },
      { type: "line", x: 0, y: 7, w: 12, h: 5, title: "Revenue trend", dataset: "timeseries" }
    ]
  },
  {
    id: "trend-deep-dive",
    theme: "paper",
    name: "Trend deep dive",
    description: "One metric, three angles: over time, by group, and against volume.",
    inspiredBy: null,
    tiles: [
      { type: "line", x: 0, y: 0, w: 12, h: 5, title: "Monthly requests", dataset: "timeseries" },
      { type: "smallMultiples", x: 0, y: 5, w: 7, h: 6, title: "Requests by group", dataset: "facets" },
      { type: "scatter", x: 7, y: 5, w: 5, h: 6, title: "Volume vs value", dataset: "scatter" }
    ]
  },
  {
    id: "geographic-snapshot",
    theme: "paper",
    name: "Geographic snapshot",
    description: "Where things happen: map first, details alongside.",
    inspiredBy: null,
    tiles: [
      { type: "choropleth", x: 0, y: 0, w: 7, h: 6, title: "Requests by state", dataset: "states" },
      { type: "kpi", x: 7, y: 0, w: 5, h: 2, title: "Key figures", dataset: "kpis" },
      { type: "bar", x: 7, y: 2, w: 5, h: 4, title: "Top categories", dataset: "categorical" },
      { type: "donut", x: 0, y: 6, w: 12, h: 4, title: "Category share", dataset: "categorical" }
    ]
  },
  {
    id: "category-comparison",
    theme: "paper",
    name: "Category comparison",
    description: "Small multiples for the full picture, ranked and share views below.",
    inspiredBy: null,
    tiles: [
      { type: "smallMultiples", x: 0, y: 0, w: 12, h: 6, title: "Performance by group", dataset: "facets" },
      { type: "dot", x: 0, y: 6, w: 7, h: 5, title: "Ranked categories", dataset: "categorical" },
      { type: "donut", x: 7, y: 6, w: 5, h: 5, title: "Share by category", dataset: "categorical" }
    ]
  },
  {
    id: "performance-scorecard",
    theme: "paper",
    name: "Performance scorecard",
    description: "Dense ops view: KPIs up top, trend, breakdown, and correlation.",
    inspiredBy: null,
    tiles: [
      { type: "kpi", x: 0, y: 0, w: 12, h: 2, title: "Scorecard", dataset: "kpis" },
      { type: "line", x: 0, y: 2, w: 6, h: 5, title: "Trend", dataset: "timeseries" },
      { type: "bar", x: 6, y: 2, w: 6, h: 5, title: "By category", dataset: "categorical" },
      { type: "scatter", x: 0, y: 7, w: 12, h: 5, title: "Volume vs value", dataset: "scatter" }
    ]
  }
];

// ── User templates (saved from the user's own dashboards) ────────────────
const USER_TPL_KEY = "dashbuilder.templates.v1";
const LEGACY_USER_TPL_KEY = "klaroDash.templates.v1"; // pre-theme era; read once, then dropped

/** Drop tiles with unknown types and clamp geometry to sane ranges. */
export function sanitizeTiles(tiles) {
  try {
    return validateLayout({ app: 'dashboard-builder', version: 1, tiles }).tiles.map(({ id,binding,...t }) => t);
  } catch { return []; }
}

export function loadUserTemplates() {
  try {
    const raw = localStorage.getItem(USER_TPL_KEY) || localStorage.getItem(LEGACY_USER_TPL_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.id === "string" && typeof t.name === "string")
      .map((t) => ({ ...t, tiles: sanitizeTiles(t.tiles) }))
      .filter((t) => t.tiles.length > 0);
  } catch {
    return [];
  }
}

function writeUserTemplates(list) {
  localStorage.setItem(USER_TPL_KEY, JSON.stringify(list));
  try {
    localStorage.removeItem(LEGACY_USER_TPL_KEY);
  } catch {
    /* ignore */
  }
}

export function saveUserTemplate(name, tiles, theme = "paper") {
  const clean = sanitizeTiles(tiles);
  if (!name.trim() || clean.length === 0) return null;
  const list = loadUserTemplates();
  const tpl = {
    id: `user-${Date.now().toString(36)}`,
    name: name.trim().slice(0, 60),
    theme,
    version: 2,
    createdAt: new Date().toISOString(),
    inspiredBy: null,
    tiles: clean
  };
  list.push(tpl);
  try {
    writeUserTemplates(list);
  } catch {
    return null;
  }
  return tpl;
}

export function deleteUserTemplate(id) {
  try {
    writeUserTemplates(loadUserTemplates().filter((t) => t.id !== id));
    return true;
  } catch {
    return false;
  }
}
