import { numericExtent } from "../data/limits.js";
import { donutParts } from "./integrity.js";
// Chart components — theme-aware, brand-neutral.
//
// Every component takes `theme` in its options (defaulting to the active
// theme from src/themes/themes.js) and renders with that theme's tokens.
// Card/chrome CSS (chartStyles) is written against CSS custom properties so
// it follows theme switches without re-rendering; Plot/SVG internals take
// concrete colors from the theme object at render time.
//
// Conventions:
// - Single-series charts default to the theme's primary data color; the
//   highlight color marks exactly one thing (a selected bar, a reference).
// - Value labels are set in the theme's mono stack with tabular-nums.
// - Pass title/subtitle/source and card() renders the full header block.

import * as Plot from "@observablehq/plot";
import { pie as d3pie, arc as d3arc } from "d3-shape";
import { feature, mesh } from "topojson-client";
import { html, svg } from "htl";
import { interpolateRgb, interpolateRgbBasis } from "d3-interpolate";
import { getTheme } from "../themes/themes.js";
import { fmtInt, fmt2, fmtCompact } from "./format.js";

// ── Theme-derived helpers ──────────────────────────────────────────────

// Relative luminance of a color string (0 = black, 1 = white).
function luminance(css) {
  const [r, g, b] = css
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Legible text color on a fill: light text on dark fills, ink on light ones.
const textOn = (fill, t) => (luminance(fill) < 0.4 ? t.onDark : t.ink);

// Sequential interpolator across the theme's 9-step ramp.
const seqInterpolate = (t) => interpolateRgbBasis(t.sequential);

// Diverging interpolator: negative → neutral → positive.
function diverging(t) {
  const neg = interpolateRgb(t.divMid, t.divNeg);
  const pos = interpolateRgb(t.divMid, t.divPos);
  return (x) => (x < 0.5 ? neg(1 - x * 2) : pos((x - 0.5) * 2));
}

// Plot theme fragment, built from the theme. Spread into every Plot.plot
// call — chart functions use themedPlot() instead of calling Plot.plot.
function themePlotDefaults(t) {
  return {
    style: {
      background: "transparent", // the card shows through
      color: t.ink,
      fontFamily: t.fonts.body,
      fontSize: "13px",
      overflow: "visible"
    },
    x: { tickSize: 0, tickPadding: 8, labelOffset: 40, line: false },
    y: { tickSize: 0, tickPadding: 8, labelOffset: 44, grid: true, line: false },
    color: { range: t.categorical }
  };
}

export function themedPlot(theme, options = {}) {
  const t = theme.chart;
  const base = themePlotDefaults(t);
  const { marks = [], x, y, color, style, ...rest } = options;
  // An explicit scale `type` takes the color config as-is; otherwise the
  // categorical range default is merged in.
  const colorScale =
    color === undefined || color.type === undefined
      ? { ...base.color, ...color }
      : { ...color };
  return Plot.plot({
    ...base,
    ...rest,
    style: { ...base.style, ...style },
    x: { ...base.x, ...x },
    y: { ...base.y, ...y },
    color: color === undefined ? base.color : colorScale,
    marks
  });
}

// Shared header block: eyebrow, title, subtitle.
function header({ eyebrow, title, subtitle }) {
  return html`<div class="db-chart-head">
    ${eyebrow ? html`<div class="db-eyebrow">${eyebrow}</div>` : ""}
    ${title ? html`<div class="db-chart-title">${title}</div>` : ""}
    ${subtitle ? html`<div class="db-chart-sub">${subtitle}</div>` : ""}
  </div>`;
}

// Card wrapper: themed card with header block + sourced footer.
export function card(node, opts = {}) {
  return html`<div class="db-card">${header(opts)}<div class="db-chart-body">${node}</div>${opts.source ? html`<div class="db-chart-source">Source: ${opts.source}</div>` : ""}</div>`;
}

// Least-squares trend line for scatterChart({trend: true}).
function trendLine(data, x, y) {
  const pts = data
    .map((d) => [+d[x], +d[y]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0);
  const sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const xs = pts.map((p) => p[0]);
  const [x0, x1] = numericExtent(xs);
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  return [
    { x: x0, y: slope * x0 + intercept },
    { x: x1, y: slope * x1 + intercept }
  ];
}

// ── Horizontal bar chart (rankings, comparisons) ─────────────────────────────
// data: rows; x: numeric field; y: category field.
// options: sort ("desc"|"asc"|null), fill (color or field), highlight (predicate),
//   valueFormat, tip (default true), width, xLabel, theme.
export function barChart(data, { x, y, sort = "desc", fill = null, highlight = null, valueFormat = fmtInt.format.bind(fmtInt), tickFormat = null, tip = true, xLabel = null, xDomain = null, width = 640, height, theme = getTheme() } = {}) {
  const t = theme.chart;
  const baseFill = fill ?? t.primary;
  const rows = sort
    ? data.slice().sort((a, b) => (sort === "desc" ? b[x] - a[x] : a[x] - b[x]))
    : data;
  const marks = [
    Plot.barX(rows, {
      x, y,
      fill: highlight ? (d) => (highlight(d) ? t.highlight : baseFill) : baseFill,
      tip
    }),
    Plot.text(rows, {
      x, y,
      text: (d) => valueFormat(d[x]),
      dx: 8,
      textAnchor: "start",
      fontFamily: t.fonts.mono,
      fontSize: 12,
      fill: t.mutedStrong
    }),
    Plot.ruleX([0], { stroke: t.border })
  ];
  return themedPlot(theme, {
    width,
    height,
    marginLeft: Math.min(120, Math.max(48, width * 0.22)),
    marginRight: Math.min(72, Math.max(36, width * 0.12)),
    x: { label: xLabel, tickFormat: (d) => (tickFormat ?? fmtInt.format.bind(fmtInt))(d), domain: xDomain ?? undefined },
    y: { label: null, domain: rows.map((d) => d[y]) },
    marks
  });
}

// ── Vertical column chart (categorical or time buckets) ──────────────────────
export function columnChart(data, { x, y, fill = null, highlight = null, valueFormat = fmtInt.format.bind(fmtInt), tickFormat = null, tip = true, yLabel = null, yDomain = null, width = 640, height, theme = getTheme() } = {}) {
  const t = theme.chart;
  const baseFill = fill ?? t.primary;
  const marks = [
    Plot.barY(data, {
      x, y,
      fill: highlight ? (d) => (highlight(d) ? t.highlight : baseFill) : baseFill,
      tip
    }),
    Plot.text(data, {
      x, y,
      text: (d) => valueFormat(d[y]),
      dy: -8,
      textAnchor: "middle",
      fontFamily: t.fonts.mono,
      fontSize: 12,
      fill: t.mutedStrong
    }),
    Plot.ruleY([0], { stroke: t.border })
  ];
  return themedPlot(theme, {
    width,
    height,
    marginBottom: 48,
    x: { label: null, tickRotate: data.length > 8 ? -30 : 0 },
    y: { label: yLabel, tickFormat: (d) => (tickFormat ?? fmtInt.format.bind(fmtInt))(d), domain: yDomain ?? undefined },
    marks
  });
}

// ── Line chart (time series; one or many series via `stroke`) ───────────────
// data: rows; x: date/number field; y: numeric field; stroke: optional series field.
export function lineChart(data, { x, y, stroke = null, width = 680, height, xLabel = null, yLabel = null, yFormat = fmtInt.format.bind(fmtInt), xDomain = null, yDomain = null, tip = true, theme = getTheme() } = {}) {
  const t = theme.chart;
  const base = { x, y, tip, strokeWidth: 2 };
  const xType = data[0] && data[0][x] instanceof Date ? "time" : typeof (data[0] && data[0][x]) === "string" ? "point" : "linear";
  const marks = stroke
    ? [
        Plot.lineY(data, { ...base, stroke }),
        Plot.dot(data, { x, y, stroke, r: 2.5, tip: false })
      ]
    : [
        Plot.lineY(data, { ...base, stroke: t.primary }),
        Plot.dot(data, { x, y, stroke: t.primary, r: 2.5, tip: false }),
        Plot.dot(data, Plot.selectLast({ x, y, fill: t.highlight, stroke: t.primary, r: 4 }))
      ];
  return themedPlot(theme, {
    width,
    height,
    x: { label: xLabel, type: xType, domain: xDomain ?? undefined },
    y: { label: yLabel, tickFormat: yFormat, domain: yDomain ?? undefined },
    color: stroke ? { range: t.categorical, legend: true } : undefined,
    marks
  });
}

// ── Scatter chart (relationships; optional trend line, size, color) ─────────
// fill: a hex color, or a field name for a color channel.
export function scatterChart(data, { x, y, r = null, fill = null, trend = false, width = 640, height, xLabel = null, yLabel = null, xDomain = null, yDomain = null, tip = true, theme = getTheme() } = {}) {
  const t = theme.chart;
  const fillIsChannel =
    typeof fill === "string" && !fill.startsWith("#") && data[0] && fill in data[0];
  const marks = [
    Plot.dot(data, {
      x, y,
      r: r ?? 3.5,
      fillOpacity: 0.75,
      tip,
      ...(r ? { r } : {}),
      ...(fillIsChannel ? { fill } : { fill: fill ?? t.primary })
    })
  ];
  if (trend) {
    const line = trendLine(data, x, y);
    if (line) marks.push(Plot.line(line, { x: "x", y: "y", stroke: t.highlight, strokeWidth: 2.5 }));
  }
  return themedPlot(theme, {
    width,
    height,
    x: { label: xLabel, nice: true, domain: xDomain ?? undefined },
    y: { label: yLabel, nice: true, domain: yDomain ?? undefined },
    marks
  });
}

// ── Dot plot / lollipop (clean alternative to bars for many categories) ──────
export function dotChart(data, { x, y, sort = "desc", width = 640, height, xLabel = null, xDomain = null, valueFormat = fmtInt.format.bind(fmtInt), tickFormat = null, theme = getTheme() } = {}) {
  const t = theme.chart;
  const rows = sort
    ? data.slice().sort((a, b) => (sort === "desc" ? b[x] - a[x] : a[x] - b[x]))
    : data;
  const tf = tickFormat ?? valueFormat;
  return themedPlot(theme, {
    width,
    height,
    marginLeft: Math.min(120, Math.max(48, width * 0.22)),
    marginRight: Math.min(64, Math.max(32, width * 0.12)),
    x: { label: xLabel, tickFormat: (d) => tf(d), domain: xDomain ?? undefined },
    y: { label: null, domain: rows.map((d) => d[y]) },
    marks: [
      Plot.ruleX(rows, { x1: 0, x2: x, y, stroke: t.mutedLight }),
      Plot.dot(rows, { x, y, fill: t.primary, r: 5, tip: true }),
      Plot.text(rows, {
        x, y,
        text: (d) => valueFormat(d[x]),
        dx: 12,
        textAnchor: "start",
        fontFamily: t.fonts.mono,
        fontSize: 12,
        fill: t.mutedStrong
      })
    ]
  });
}

// ── Choropleth (state / county maps) ─────────────────────────────────────────
// data: rows with an id field matching the topology's feature ids (e.g. FIPS
// codes for us-atlas). geo: a TopoJSON topology object; object: the key inside
// topology.objects ("states", "counties", ...). Areas with no data render in
// the theme's unknown fill. center: set to 0 to symmetrize the domain around
// a midpoint. Swap in counties-10m.json for county detail.
export function choropleth(data, {
  geo, object = "states",
  id, value,
  valueFormat = fmtCompact.format.bind(fmtCompact),
  diverging: div = false,
  domain = null,
  center = null,
  projection = "albers-usa",
  width = 640,
  height = Math.round(width * 0.62),
  tip = true,
  theme = getTheme()
} = {}) {
  const t = theme.chart;
  const features = feature(geo, geo.objects[object]).features;
  const borders = mesh(geo, geo.objects[object], (a, b) => a !== b);
  const values = new Map(data.map((d) => [String(d[id]), d[value]]));
  const nums = [...values.values()].filter((v) => v != null);
  let lo = domain ? domain[0] : numericExtent(nums)[0];
  let hi = domain ? domain[1] : numericExtent(nums)[1];
  if (center != null && domain == null) {
    const dev = Math.max(Math.abs(hi - center), Math.abs(lo - center));
    lo = center - dev;
    hi = center + dev;
  }
  const getValue = (f) => values.get(String(f.id));
  const getName = (f) => {
    const row = data.find((d) => String(d[id]) === String(f.id));
    return (row && (row.state || row.name)) || (f.properties && f.properties.name) || String(f.id);
  };

  return themedPlot(theme, {
    width,
    height,
    projection,
    x: { axis: null, grid: false },
    y: { axis: null, grid: false },
    color: div
      ? { type: "diverging", interpolate: diverging(t), domain: [lo, hi], unknown: t.unknown }
      : { type: "linear", range: t.sequential, domain: [lo, hi], unknown: t.unknown },
    marks: [
      Plot.geo(features, {
        fill: (f) => getValue(f) ?? null,
        stroke: t.card, strokeWidth: 0.75,
        tip,
        title: (f) => {
          const v = getValue(f);
          return v == null ? `${getName(f)}: no data` : `${getName(f)}: ${valueFormat(v)}`;
        }
      }),
      Plot.geo(borders, { stroke: t.card, strokeWidth: 0.75, fill: "none" })
    ]
  });
}

// ── Small multiples (faceted charts, shared scale) ───────────────────────────
// data: rows; facet: facet field; value: numeric field used for the shared domain.
// chart: (rows, {yDomain, width}) => node — build one facet's chart, wiring
//   yDomain into the inner chart so every panel shares the scale (the thing
//   that makes small multiples honest).
export function smallMultiples(data, {
  facet,
  value,
  chart,
  columns = 3,
  chartWidth = 300,
  yDomain = null,
  includeZero = true,
  facetSort = null,
  facetLabel = (v) => v
} = {}) {
  const groups = new Map();
  for (const d of data) {
    const k = d[facet];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  let keys = [...groups.keys()];
  if (facetSort === "asc" || facetSort === "desc") {
    const totals = new Map(keys.map((k) => [k, groups.get(k).reduce((s, d) => s + (d[value] ?? 0), 0)]));
    keys.sort((a, b) => (facetSort === "desc" ? totals.get(b) - totals.get(a) : totals.get(a) - totals.get(b)));
  } else if (typeof facetSort === "function") {
    keys.sort(facetSort);
  }
  const nums = data.map((d) => d[value]).filter((v) => v != null);
  let [lo, hi] = numericExtent(nums);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const shared = yDomain ?? [lo, hi];

  const grid = html`<div class="db-facets" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));"></div>`;
  for (const k of keys) {
    const panel = html`<div class="db-facet"><div class="db-facet-label">${facetLabel(k)}</div></div>`;
    panel.appendChild(chart(groups.get(k), { yDomain: shared, width: chartWidth }));
    grid.appendChild(panel);
  }
  return grid;
}

// ── Donut chart (parts of a whole, ≤6 slices) ────────────────────────────────
// data: rows; value: numeric field; label: category field.
// Note: Observable Plot has no arc/pie mark, so this renders raw SVG via
// d3-shape pie+arc generators and htl — same theme, no Plot dependency.
export function donutChart(data, { value, label, width = 420, height = width + 80, outerRadius = 150, innerRadius = 96, valueFormat = fmtInt.format.bind(fmtInt), theme = getTheme() } = {}) {
  const t = theme.chart;
  width = Math.max(80, Math.min(width, height - 80, 400));
  data = donutParts(data, label, value);
  const total = data.reduce((s, d) => s + d[value], 0);
  const slices = d3pie().value((d) => d[value]).sort(null)(data);
  const arcGen = d3arc().innerRadius(innerRadius).outerRadius(outerRadius);
  const colors = data.map((_, i) => t.categorical[i % t.categorical.length]);
  const size = outerRadius * 2 + 48;
  const c = size / 2;
  return html`<div class="db-donut">
    ${svg`<svg width="${width}" height="${width}" viewBox="0 0 ${size} ${size}" role="img">
      <g transform="translate(${c} ${c})">
        ${slices.map((s, i) => svg`<path d="${arcGen(s)}" fill="${colors[i]}" stroke="${t.card}" stroke-width="2"><title>${s.data[label]}: ${valueFormat(s.data[value])}</title></path>`)}
        <text text-anchor="middle" dy="-6" font-family="${t.fonts.mono}" font-weight="500" font-size="22" fill="${t.ink}">${valueFormat(total)}</text>
        <text text-anchor="middle" dy="16" font-size="11" fill="${t.muted}">total</text>
      </g>
    </svg>`}
    <div class="db-legend">
      ${data.map((d, i) => html`<span class="db-legend-item"><span class="db-swatch" style="background:${colors[i]}"></span>${d[label]}&nbsp;<span class="db-fig">${valueFormat(d[value])}</span></span>`)}
    </div>
  </div>`;
}

// ── KPI cards ────────────────────────────────────────────────────────────────
// kpiRow([{value, label, delta, deltaDir}]) — deltaDir: "up"|"down"|null.
// Positive deltas render the theme's success color, negative the danger
// color; pass invert: true when down is good (e.g. costs). Colors come from
// CSS custom properties, so no theme object is needed here.
export function kpiRow(cards) {
  return html`<div class="db-kpi-row">
    ${cards.map(
      (c) => html`<div class="db-kpi">
        <div class="db-kpi-value">${c.value}</div>
        <div class="db-kpi-label">${c.label}</div>
        ${c.delta
          ? html`<div class="db-kpi-delta ${deltaClass(c.deltaDir, c.invert)}">${c.delta}</div>`
          : ""}
      </div>`
    )}
  </div>`;
}

function deltaClass(dir, invert) {
  if (!dir) return "";
  const good = invert ? dir === "down" : dir === "up";
  return good ? "db-delta-good" : "db-delta-bad";
}

// Shared CSS for cards, headers, KPIs, legends. Written against the theme's
// CSS custom properties, so it follows theme switches without re-rendering.
// Include once per page.
export const chartStyles = html`<style>
.chart-data { margin: 8px 0; overflow: auto; }
.chart-data table { border-collapse: collapse; width: 100%; font-size: 12px; }
.chart-data td, .chart-data th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--slate-200); }
.chart-data summary { cursor: pointer; }
.chart-data button { margin: 4px 8px; }
.chart-transform-note { color: var(--slate-600); font-size: 12px; }
:focus-visible { outline: 3px solid var(--periwinkle); outline-offset: 3px; }
  .db-card {
    background: var(--white);
    border: 1px solid var(--slate-200);
    border-radius: 10px;
    box-shadow: var(--card-shadow);
    padding: 24px;
    margin: 0 0 32px 0;
  }
  .db-eyebrow {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--slate-500);
    margin-bottom: 8px;
  }
  .db-chart-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 28px;
    line-height: 1.25;
    letter-spacing: 0.04em;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .db-chart-sub {
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
    color: var(--slate-600);
    margin-bottom: 16px;
    max-width: 60ch;
  }
  .db-chart-source {
    font-family: var(--font-body);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.02em;
    color: var(--slate-500);
    margin-top: 16px;
  }
  .tile-chart .db-card { padding: 16px; margin: 0; }
  .tile-chart .db-chart-title { font-size: 18px; line-height: 1.3; }
  .db-chart-head:empty { display: none; }
  .db-chart-body { min-width: 0; }
  .db-chart-body svg { max-width: 100%; }
  .db-chart-body figure { margin: 0; }
  .db-fig { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .db-kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
    gap: 16px;
    margin: 0;
  }
  .db-kpi {
    background: var(--white);
    border: 1px solid var(--slate-200);
    border-radius: 10px;
    box-shadow: var(--card-shadow);
    padding: 16px;
  }
  .db-kpi-value {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 28px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
  }
  .db-kpi-label {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--slate-500);
  }
  .db-kpi-delta { font-family: var(--font-mono); font-size: 13px; margin-top: 8px; }
  .db-delta-good { color: var(--success); }
  .db-delta-bad { color: var(--danger); }
  .db-donut { display: flex; flex-direction: column; align-items: center; }
  .db-legend {
    display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: center;
    margin-top: 12px; max-width: 560px;
  }
  .db-legend-item {
    display: inline-flex; align-items: center;
    font-family: var(--font-body); font-size: 13px; color: var(--slate-600);
  }
  .db-swatch {
    display: inline-block; width: 12px; height: 12px; border-radius: 3px;
    margin-right: 8px;
  }
  .db-facets { display: grid; gap: 28px 24px; margin-top: 4px; }
  .db-facet-label {
    font-family: var(--font-body); font-size: 12px; font-weight: 500;
    color: var(--slate-600); margin-bottom: 2px;
  }
</style>`;
