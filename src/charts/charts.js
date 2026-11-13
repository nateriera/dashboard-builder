import { numericExtent } from "../data/limits.js";
import { donutParts, donutSourceLabels } from "./integrity.js";
import { timeMarkRender } from './timeMarks.js';
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
import { hierarchy, treemap as d3treemap } from "d3-hierarchy";
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
    // insetTop: the top tick label clears the "↑ label" above the frame.
    y: { tickSize: 0, tickPadding: 8, labelOffset: 44, grid: true, line: false, insetTop: 8 },
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
  const axes = axisLayout({ ...rest, x: { ...base.x, ...x }, y: { ...base.y, ...y } }, t);
  const render = layout => Plot.plot({
    ...base,
    ...rest,
    style: { ...base.style, ...style },
    ...layout,
    color: color === undefined ? base.color : colorScale,
    marks
  });
  const plot = render(axes);
  const scale = plot.scale("y");
  if (scale && !["band", "point", "ordinal"].includes(scale.type)) {
    const measured = axisLayout({ ...rest, x: { ...base.x, ...x }, y: { ...base.y, ...y }, yTickDomain: scale.domain }, t);
    if (measured.marginLeft > axes.marginLeft) return render(measured);
  }
  return plot;
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

function crossfilterAriaLabel(value) {
  return `Category: ${String(value ?? "")}`;
}

function crossfilterHref(value) {
  return `#db-crossfilter:${encodeURIComponent(JSON.stringify([value]))}`;
}

// ── Scale-aware number formats (PR #42 review, B2/N4) ─────────────────────
// Axes used to format every tick with fmtInt, so narrow-range decimal data
// (revenue 1.6–2.4 $M) printed the same integer on every tick. Precision now
// follows the span the axis covers; integer-scaled data formats as before.
const numberFormats = new Map();
function fixedFormat(min, max) {
  const key = `${min}:${max}`;
  if (!numberFormats.has(key)) {
    const f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormats.set(key, f.format.bind(f));
  }
  return numberFormats.get(key);
}
function finiteNumbers(values) {
  return values.map(v => typeof v === "string" && v.trim() !== "" ? Number(v) : v).filter(v => typeof v === "number" && Number.isFinite(v));
}
function spanDecimals(nums) {
  if (!nums.length) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const v of nums) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const unit = hi > lo ? (hi - lo) / 5 : Math.abs(hi);
  if (!(unit > 0)) return 0;
  return Math.min(3, Math.max(0, -Math.floor(Math.log10(unit))));
}
/** Tick formatter for a numeric axis covering `values` (include 0/reference when the domain does). */
export function axisFormat(values) {
  const d = spanDecimals(finiteNumbers(values));
  return d ? fixedFormat(d, d + 1) : fmtInt.format.bind(fmtInt);
}
/** Value-label formatter: integers stay integers; decimal data keeps at least one decimal (−0.3 never prints "-0"). */
export function valueLabelFormat(values) {
  const nums = finiteNumbers(values);
  if (nums.every(Number.isInteger)) return fmtInt.format.bind(fmtInt);
  return fixedFormat(0, Math.max(1, spanDecimals(nums) + 1));
}
/** Plot's own ascending order for an ordinal domain, made explicit (an inferred
 * band domain of year-like strings logs a warning and draws a ⚠ glyph; N2). */
function naturalDomain(values) {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── Category axis sizing (PR #42 review, B4) ────────────────────────────────
// Left category labels are set in the mono tick font (see chartStyles), about
// 0.6em per glyph. A fixed min(120, 22% of width) margin clipped the first
// letters of any label over ~14 characters. The margin is now measured from
// the labels, capped at a share of the chart width; only a label longer than
// the cap is shortened, at its end, with an ellipsis (never clipped).
const TICK_FONT_PX = 13;
let measureContext;
function labelWidth(text, font) {
  if (measureContext === undefined) {
    try { measureContext = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d") : null; } catch { measureContext = null; }
  }
  const estimate = text.length * TICK_FONT_PX * 0.62;
  if (!measureContext) return estimate;
  measureContext.font = font;
  return Math.max(measureContext.measureText(text).width, estimate * 0.9);
}
function fitLabel(text, room, font) {
  if (labelWidth(text, font) <= room) return text;
  let n = text.length;
  while (n > 1 && labelWidth(text.slice(0, n).trimEnd() + "…", font) > room) n--;
  return text.slice(0, n).trimEnd() + "…";
}
/** marginLeft (and, only when labels exceed the cap, a shortening tickFormat) for a left category axis. */
export function categoryAxis(labels, width, theme = getTheme(), { min = 48, maxShare = 0.5 } = {}) {
  const font = `${TICK_FONT_PX}px ${theme.chart.fonts.mono}`;
  const gap = 8 + 6; // Plot tickPadding + slack
  const longest = Math.max(0, ...labels.map(label => labelWidth(String(label ?? ""), font)));
  const cap = Math.max(min, Math.floor(width * maxShare));
  const need = Math.ceil(longest) + gap;
  const marginLeft = Math.min(cap, Math.max(min, need));
  return need <= cap ? { marginLeft } : { marginLeft, tickFormat: label => fitLabel(String(label ?? ""), marginLeft - gap, font) };
}
// Axis titles use the same 13px font as before. Newlines retain the whole
// label; extra margins reserve their space instead of scaling the SVG text.
function wrapAxisTitle(label, room, font) {
  if (typeof label !== "string") return label;
  const lines = [];
  for (const paragraph of label.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && labelWidth(`${line} ${word}`, font) <= room) {
        line += ` ${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // User-provided units can be one long token. Break it without ellipsis.
      for (const character of word) {
        if (line && labelWidth(line + character, font) > room) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trim());
  }
  return lines.join("\n");
}

function axisLayout(options, theme) {
  const { width = 640, x, y } = options;
  const font = `13px ${theme.fonts.body}`;
  const room = Math.max(40, width - 32); // leave room for Plot's direction arrow
  const nextX = { ...x, label: wrapAxisTitle(x.label, room, font) };
  const nextY = { ...y, label: wrapAxisTitle(y.label, room, font) };
  const top = nextY.label ? nextY.label.split("\n").length * 16 + 12 : 20;
  const bottom = nextX.label ? nextX.label.split("\n").length * 16 + 40 : ["time", "utc"].includes(x.type) ? 48 : 30;
  const yTickDomain = options.yTickDomain ?? y.domain;
  const numericY = yTickDomain?.every(value => typeof value === "number");
  const yTickWidth = numericY ? Math.max(0, ...yTickDomain.map(value => labelWidth(
    String(typeof y.tickFormat === "function" ? y.tickFormat(value) : fmtInt.format(value)),
    `13px ${theme.fonts.mono}`
  ))) + 14 : 0;
  const marginLeft = Math.max(options.marginLeft ?? 40, Math.ceil(yTickWidth));
  const marginTop = Math.max(options.marginTop ?? 20, top);
  const marginBottom = Math.max(options.marginBottom ?? 30, bottom);
  if (nextY.label) nextY.labelOffset = marginLeft - 8;
  if (nextX.label) nextX.labelOffset = marginBottom - 12;
  return {
    x: nextX, y: nextY, marginTop, marginBottom, marginLeft,
    // Small fixed tiles can scroll vertically; never crush the plotting area
    // to make room for readable titles and categorical ticks.
    ...(options.height ? { height: Math.max(
      options.height + marginTop - (options.marginTop ?? 20) + marginBottom - (options.marginBottom ?? 30),
      marginTop + marginBottom + Math.max(100, (options.fy?.domain?.length ?? y.domain?.length ?? 0) * 20)
    ) } : {})
  };
}

/** Keep every categorical bottom tick; vertical labels avoid both overlap
 * and the left-edge clipping caused by long labels rotated only 30 degrees. */
function bandAxis(labels, width, theme = getTheme(), { marginX = 60 } = {}) {
  const font = `${TICK_FONT_PX}px ${theme.chart.fonts.mono}`;
  const longest = Math.max(0, ...labels.map(label => labelWidth(String(label ?? ""), font)));
  const band = (width - marginX) / Math.max(1, labels.length);
  if (longest <= band * 0.92) return { tickRotate: 0, marginBottom: 48 };
  return { tickRotate: -90, marginBottom: Math.ceil(longest) + 28 };
}

function axisMaximum(rows, field) {
  let maximum = null;
  for (const row of rows) {
    const value = row[field];
    if (value == null) continue;
    const comparable = value instanceof Date ? value.getTime() : value;
    const current = maximum instanceof Date ? maximum.getTime() : maximum;
    if (maximum === null || comparable > current) maximum = value;
  }
  return maximum;
}

function domainWithReference(values, referenceValue, baseDomain = null, includeZero = false) {
  if (referenceValue === null || referenceValue === undefined || referenceValue === "" || !Number.isFinite(Number(referenceValue))) return baseDomain ?? undefined;
  const reference = Number(referenceValue);
  const numbers = [...(baseDomain || []), ...values].filter(value => typeof value === "number" && Number.isFinite(value));
  const [baseMin, baseMax] = numericExtent(numbers, includeZero);
  if (reference >= baseMin && reference <= baseMax) return baseDomain ?? undefined;
  let lo = Math.min(baseMin, reference), hi = Math.max(baseMax, reference);
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const padding = (hi - lo) * 0.04 || Math.max(1, Math.abs(reference) * 0.04);
  return [lo - padding, hi + padding];
}

function histogramBins(rows, field, bins) {
  const values = rows.map(row => row[field]).filter(value => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return {bins:[],degenerate:false};
  let lo=values[0],hi=values[0];for(const value of values){lo=Math.min(lo,value);hi=Math.max(hi,value);}
  if (lo === hi) return {bins:[{x0:lo-.5,x1:lo+.5,count:values.length}],degenerate:true};
  const count = Math.max(1, Math.round(Number(bins) || 1));
  const width = (hi - lo) / count, counts = Array(count).fill(0);
  for (const value of values) counts[Math.min(count - 1, Math.floor((value - lo) / width))]++;
  return {bins:counts.map((value,index)=>({x0:lo+index*width,x1:index===count-1?hi:lo+(index+1)*width,count:value})),degenerate:false};
}

/** Theme-aware reference line and optional label at the value-axis endpoint. */
export function referenceMarks(axis, value, label, theme, anchor = {}) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return [];
  const t = theme.chart;
  const numeric = Number(value);
  const marks = [axis === "x"
    ? Plot.ruleX([numeric], { stroke: t.ink, strokeOpacity: 0.68, strokeDasharray: "5,4", strokeWidth: 1.5, ariaLabel: "Reference line" })
    : Plot.ruleY([numeric], { stroke: t.ink, strokeOpacity: 0.68, strokeDasharray: "5,4", strokeWidth: 1.5, ariaLabel: "Reference line" })];
  if (typeof label === "string" && label.trim() && anchor.x != null && anchor.y != null) {
    // The caption sits off the data (PR #42 review, N5): above the frame for a
    // vertical rule, at the line's start for a horizontal one. Anchoring it to
    // the first category or last point printed it over that mark's label.
    const text = { text: "label", fill: t.ink, stroke: t.card, strokeWidth: 3, paintOrder: "stroke", fontSize: 11 };
    marks.push(axis === "x"
      ? Plot.text([{ x: numeric, label: label.trim() }], { ...text, x: "x", frameAnchor: "top", textAnchor: "middle", dy: -9 })
      : Plot.text([{ y: numeric, label: label.trim() }], { ...text, y: "y", frameAnchor: "left", textAnchor: "start", dx: 4, dy: -7 }));
  }
  return marks;
}

// ── Horizontal bar chart (rankings, comparisons) ─────────────────────────────
// data: rows; x: numeric field; y: category field.
// options: sort ("desc"|"asc"|null), fill (color or field), highlight (predicate),
//   valueFormat, tip (default true), width, xLabel, theme.
export function barChart(data, { x, y, sort = "desc", fill = null, highlight = null, valueFormat = null, tickFormat = null, tip = true, xLabel = null, xDomain = null, width = 640, height, theme = getTheme(), referenceValue = null, referenceLabel = "", crossfilterField = null } = {}) {
  const t = theme.chart;
  const baseFill = fill ?? t.primary;
  const rows = sort
    ? data.slice().sort((a, b) => (sort === "desc" ? b[x] - a[x] : a[x] - b[x]))
    : data;
  valueFormat ??= valueLabelFormat(rows.map(row => row[x]));
  const categories = categoryAxis(rows.map(d => d[y]), width, theme);
  const marks = [
    Plot.barX(rows, {
      x, y,
      fill: highlight ? (d) => (highlight(d) ? t.highlight : baseFill) : baseFill,
      ...(crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => crossfilterHref(d[crossfilterField]) } : {}),
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
    Plot.ruleX([0], { stroke: t.border }),
    ...referenceMarks("x", referenceValue, referenceLabel, theme, { x: Number(referenceValue), y: rows[0]?.[y] })
  ];
  return themedPlot(theme, {
    width,
    height,
    marginLeft: categories.marginLeft,
    marginRight: Math.min(72, Math.max(36, width * 0.12)),
    x: { label: xLabel, tickFormat: tickFormat ?? axisFormat([0, ...rows.map(row => row[x]), ...(xDomain || []), referenceValue]), domain: domainWithReference(rows.map(row => row[x]), referenceValue, xDomain, true) },
    y: { label: null, domain: rows.map((d) => d[y]), ...(categories.tickFormat ? { tickFormat: categories.tickFormat } : {}) },
    marks
  });
}

// ── Vertical column chart (categorical or time buckets) ──────────────────────
export function columnChart(data, { x, y, sort = "desc", fill = null, highlight = null, valueFormat = null, tickFormat = null, tip = true, yLabel = null, yDomain = null, width = 640, height, theme = getTheme(), referenceValue = null, referenceLabel = "", crossfilterField = null } = {}) {
  const t = theme.chart;
  const baseFill = fill ?? t.primary;
  const rows = sort
    ? data.slice().sort((a, b) => (sort === "desc" ? b[y] - a[y] : a[y] - b[y]))
    : data;
  valueFormat ??= valueLabelFormat(rows.map(row => row[y]));
  // Rotate category labels only when they are wider than their band (B4).
  const bands = bandAxis(rows.map(d => d[x]), width, theme);
  const marks = [
    Plot.barY(rows, {
      x, y,
      fill: highlight ? (d) => (highlight(d) ? t.highlight : baseFill) : baseFill,
      ...(crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => crossfilterHref(d[crossfilterField]) } : {}),
      tip
    }),
    Plot.text(rows, {
      x, y,
      text: (d) => valueFormat(d[y]),
      dy: -8,
      textAnchor: "middle",
      fontFamily: t.fonts.mono,
      fontSize: 12,
      fill: t.mutedStrong
    }),
    Plot.ruleY([0], { stroke: t.border }),
    ...referenceMarks("y", referenceValue, referenceLabel, theme, { x: rows.at(-1)?.[x], y: Number(referenceValue) })
  ];
  return themedPlot(theme, {
    width,
    height,
    marginBottom: bands.marginBottom,
    x: { label: null, domain: rows.map(d => d[x]), tickRotate: bands.tickRotate },
    // insetTop keeps the tallest bar's value label inside the frame, clear of the y-axis label.
    y: { label: yLabel, insetTop: 14, tickFormat: tickFormat ?? axisFormat([0, ...rows.map(row => row[y]), ...(yDomain || []), referenceValue]), domain: domainWithReference(rows.map(row => row[y]), referenceValue, yDomain, true) },
    marks
  });
}

// ── Line chart (time series; one or many series via `stroke`) ───────────────
// data: rows; x: date/number field; y: numeric field; stroke: optional series field.
export function lineChart(data, { x, y, stroke = null, width = 680, height, xLabel = null, yLabel = null, yFormat = null, xDomain = null, yDomain = null, tip = true, theme = getTheme(), referenceValue = null, referenceLabel = "", sourceRows = data } = {}) {
  const t = theme.chart;
  const base = { x, y, tip, strokeWidth: 2 };
  const render = timeMarkRender(data, sourceRows, x);
  const xType = data[0] && data[0][x] instanceof Date ? "time" : typeof (data[0] && data[0][x]) === "string" ? "point" : "linear";
  const marks = stroke
    ? [
        Plot.lineY(data, { ...base, stroke }),
        Plot.dot(data, { x, y, stroke, r: 2.5, tip: false, render })
      ]
    : [
        Plot.lineY(data, { ...base, stroke: t.primary }),
        Plot.dot(data, { x, y, stroke: t.primary, r: 2.5, tip: false, render }),
        Plot.dot(data, Plot.selectLast({ x, y, fill: t.highlight, stroke: t.primary, r: 4, render }))
      ];
  marks.push(...referenceMarks("y", referenceValue, referenceLabel, theme, { x: axisMaximum(data, x), y: Number(referenceValue) }));
  // Category x (FY22, 25Q1, 2019…): rotate only when labels outgrow their slot (B4).
  const points = xType === "point" ? bandAxis(naturalDomain(data.map(d => d[x])), width, theme) : null;
  return themedPlot(theme, {
    width,
    height,
    ...(points?.tickRotate ? { marginBottom: points.marginBottom } : {}),
    x: { label: xLabel, type: xType, domain: xDomain ?? undefined, ...(points?.tickRotate ? { tickRotate: points.tickRotate } : {}) },
    y: { label: yLabel, tickFormat: yFormat ?? axisFormat([...data.map(row => row[y]), ...(yDomain || []), referenceValue]), domain: domainWithReference(data.map(row => row[y]), referenceValue, yDomain) },
    color: stroke ? { range: t.categorical, legend: true } : undefined,
    marks
  });
}

// ── Scatter chart (relationships; optional trend line, size, color) ─────────
// fill: a hex color, or a field name for a color channel.
export function scatterChart(data, { x, y, r = null, fill = null, trend = false, width = 640, height, xLabel = null, yLabel = null, xDomain = null, yDomain = null, tip = true, theme = getTheme(), referenceValue = null, referenceLabel = "", crossfilterField = null } = {}) {
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
      ...(fillIsChannel ? { fill } : { fill: fill ?? t.primary }),
      ...(crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => d[crossfilterField] == null ? null : crossfilterHref(d[crossfilterField]) } : {})
    })
  ];
  if (trend) {
    const line = trendLine(data, x, y);
    if (line) marks.push(Plot.line(line, { x: "x", y: "y", stroke: t.highlight, strokeWidth: 2.5 }));
  }
  marks.push(...referenceMarks("y", referenceValue, referenceLabel, theme, { x: axisMaximum(data, x), y: Number(referenceValue) }));
  return themedPlot(theme, {
    width,
    height,
    x: { label: xLabel, nice: true, domain: xDomain ?? undefined },
    y: { label: yLabel, nice: true, domain: domainWithReference(data.map(row => row[y]), referenceValue, yDomain) },
    marks
  });
}

// ── Dot plot / lollipop (clean alternative to bars for many categories) ──────
export function dotChart(data, { x, y, sort = "desc", width = 640, height, xLabel = null, xDomain = null, valueFormat = null, tickFormat = null, theme = getTheme(), referenceValue = null, referenceLabel = "", crossfilterField = null } = {}) {
  const t = theme.chart;
  const rows = sort
    ? data.slice().sort((a, b) => (sort === "desc" ? b[x] - a[x] : a[x] - b[x]))
    : data;
  valueFormat ??= valueLabelFormat(rows.map(row => row[x]));
  const tf = tickFormat ?? axisFormat([0, ...rows.map(row => row[x]), ...(xDomain || []), referenceValue]);
  const categories = categoryAxis(rows.map(d => d[y]), width, theme);
  return themedPlot(theme, {
    width,
    height,
    marginLeft: categories.marginLeft,
    marginRight: Math.min(64, Math.max(32, width * 0.12)),
    x: { label: xLabel, tickFormat: tf, domain: domainWithReference(rows.map(row => row[x]), referenceValue, xDomain, true) },
    y: { label: null, domain: rows.map((d) => d[y]), ...(categories.tickFormat ? { tickFormat: categories.tickFormat } : {}) },
    marks: [
      Plot.ruleX(rows, { x1: 0, x2: x, y, stroke: t.mutedLight }),
      Plot.dot(rows, { x, y, fill: t.primary, r: 5, tip: true, ...(crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => crossfilterHref(d[crossfilterField]) } : {}) }),
      Plot.text(rows, {
        x, y,
        text: (d) => valueFormat(d[x]),
        dx: 12,
        textAnchor: "start",
        fontFamily: t.fonts.mono,
        fontSize: 12,
        fill: t.mutedStrong
      }),
      ...referenceMarks("x", referenceValue, referenceLabel, theme, { x: Number(referenceValue), y: rows[0]?.[y] })
    ]
  });
}

// ── Stacked and grouped category comparisons ────────────────────────────────
export function stackedBarChart(data, { mode = "stacked", width = 640, height, xLabel = null, theme = getTheme(), crossfilterField = null } = {}) {
  const t = theme.chart;
  const series = [...new Set(data.map(d => d.series))];
  const labels = [...new Set(data.map(d => d.label))];
  const color = { domain: series, range: t.categorical, legend: true };
  const categories = categoryAxis(labels, width, theme, { min: 60 });
  const crossfilter = crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => crossfilterHref(d[crossfilterField]) } : {};
  const values = data.map(d => d.value);
  if (mode === "grouped") {
    // Grouped = one band per category (fy) holding one bar per series, so each
    // category label prints once (PR #42 review, B3: per-series bands used to
    // repeat every label once per series).
    return themedPlot(theme, {width,height,marginLeft:categories.marginLeft,
      fy:{label:null,domain:labels,padding:0.18,axis:"left",tickSize:0,tickPadding:8,...(categories.tickFormat?{tickFormat:categories.tickFormat}:{})},
      x:{label:xLabel??null,tickFormat:axisFormat([0,...values])},
      y:{axis:null,domain:series,grid:false},
      color,
      marks:[Plot.barX(data,{fy:"label",y:"series",x:"value",fill:"series",tip:true,...crossfilter}),Plot.ruleX([0],{stroke:t.border})]});
  }
  const totals = labels.map(label => data.filter(d => d.label === label).reduce((sum, d) => sum + (Number(d.value) || 0), 0));
  const marks = [Plot.barX(data, Plot.stackX({z:"series"},{x:"value",y:"label",fill:"series",tip:true,...crossfilter}))];
  return themedPlot(theme, {width,height,marginLeft:categories.marginLeft,x:{label:xLabel??null,tickFormat:axisFormat([0,...totals])},y:{label:null,domain:naturalDomain(labels),...(categories.tickFormat?{tickFormat:categories.tickFormat}:{})},color,marks});
}

export function stackedColumnChart(data, { mode = "stacked", width = 640, height, yLabel = null, theme = getTheme(), crossfilterField = null } = {}) {
  const t = theme.chart;
  const series = [...new Set(data.map(d => d.series))];
  const labels = [...new Set(data.map(d => d.label))];
  const color = { domain: series, range: t.categorical, legend: true };
  const crossfilter = crossfilterField ? { ariaLabel: d => crossfilterAriaLabel(d[crossfilterField]), href: d => crossfilterHref(d[crossfilterField]) } : {};
  const bands = bandAxis(labels, width, theme);
  if (mode === "grouped") {
    // One band per category (fx) holding one column per series (PR #42 review, B3).
    return themedPlot(theme, {width,height,marginBottom:bands.marginBottom,
      fx:{label:null,domain:labels,padding:0.18,axis:"bottom",tickSize:0,tickPadding:8,tickRotate:bands.tickRotate},
      x:{axis:null,domain:series},
      y:{label:yLabel??null,tickFormat:axisFormat([0,...data.map(d => d.value)])},
      color,
      marks:[Plot.barY(data,{fx:"label",x:"series",y:"value",fill:"series",tip:true,...crossfilter}),Plot.ruleY([0],{stroke:t.border})]});
  }
  const totals = labels.map(label => data.filter(d => d.label === label).reduce((sum, d) => sum + (Number(d.value) || 0), 0));
  return themedPlot(theme, {width,height,marginBottom:bands.marginBottom,x:{label:null,domain:naturalDomain(labels),tickRotate:bands.tickRotate},y:{label:yLabel??null,tickFormat:axisFormat([0,...totals])},color,marks:[Plot.barY(data,Plot.stackY({z:"series"},{x:"label",y:"value",fill:"series",tip:true,...crossfilter})),Plot.ruleY([0],{stroke:t.border})]});
}

export function histogramChart(data, { value = "value", bins = 20, preBinned = false, width = 640, height, xLabel = null, theme = getTheme(), referenceValue = null, referenceLabel = "" } = {}) {
  const result=preBinned
    ? {bins:data.map(row=>({x0:Number(row.start),x1:Number(row.end),count:Number(row[value]),key:row.key})).filter(bin=>Number.isFinite(bin.x0)&&Number.isFinite(bin.x1)&&Number.isFinite(bin.count)),degenerate:false}
    : histogramBins(data,value,bins);
  const counts=result.bins.map(bin=>bin.count);
  const xMaximum=preBinned?Math.max(...result.bins.map(bin=>bin.x1),0):axisMaximum(data,value);
  const plot=themedPlot(theme,{width,height,marginLeft:56,x:{label:xLabel??null},y:{label:"Count",grid:true,tickFormat:fmtInt.format.bind(fmtInt),domain:domainWithReference(counts,referenceValue,null,true)},marks:[Plot.rectY(result.bins,{x1:"x0",x2:"x1",y:"count",tip:true,ariaLabel:d=>`${d.count} values from ${d.x0} to ${d.x1}`}),Plot.ruleY([0],{stroke:theme.chart.border}),...referenceMarks("y",referenceValue,referenceLabel,theme,{x:xMaximum,y:Number(referenceValue)})]});
  const root=document.createElement("div");root.className="db-histogram";root.dataset.binCount=String(result.bins.length);root.dataset.degenerate=String(result.degenerate);root.dataset.counts=JSON.stringify(counts);root.dataset.preBinned=String(preBinned);root.append(plot);
  if(result.degenerate){const label=document.createElement("p");label.className="db-histogram-degenerate";label.textContent="Degenerate range — one bin centered on the value (width 1).";root.append(label);}
  return root;
}

export function boxplotChart(data, { label = "label", value = "value", width = 640, height, yLabel = null, theme = getTheme(), referenceValue = null, referenceLabel = "" } = {}) {
  const t=theme.chart;
  const categories=[...new Set(data.map(row=>row[label]))];
  return themedPlot(theme,{width,height,marginBottom:48,x:{label:null,tickRotate:categories.length>12?-30:0},y:{label:yLabel,grid:true,tickFormat:fmtInt.format.bind(fmtInt),domain:domainWithReference(data.map(row=>row[value]),referenceValue)},marks:[Plot.boxY(data,{x:label,y:value,fill:t.primary,tip:true}),Plot.ruleY([0],{stroke:t.border}),...referenceMarks("y",referenceValue,referenceLabel,theme,{x:categories.at(-1),y:Number(referenceValue)})]});
}

export function areaChart(data, { x = "date", y = "value", series = null, width = 680, height, xLabel = null, yLabel = null, theme = getTheme(), referenceValue = null, referenceLabel = "", sourceRows = data } = {}) {
  const t=theme.chart;
  const xType=data[0]?.[x] instanceof Date?"time":typeof data[0]?.[x]==="string"?"point":"linear";
  const marks=series?
    [Plot.areaY(data,{x,y1:0,y2:y,z:series,fill:series,fillOpacity:.18,tip:true}),Plot.lineY(data,{x,y,z:series,stroke:series,strokeWidth:1.5})]:
    [Plot.areaY(data,{x,y1:0,y2:y,fill:t.primary,fillOpacity:.45,tip:true}),Plot.lineY(data,{x,y,stroke:t.primary,strokeWidth:2})];
  marks.push(Plot.dot(data,{x,y,r:1,fillOpacity:0,strokeOpacity:0,tip:false,ariaLabel:()=>"",render:timeMarkRender(data,sourceRows,x)}));
  marks.push(...referenceMarks("y",referenceValue,referenceLabel,theme,{x:axisMaximum(data,x),y:Number(referenceValue)}));
  return themedPlot(theme,{width,height,x:{label:xLabel??null,type:xType},y:{label:yLabel??null,tickFormat:fmtInt.format.bind(fmtInt),grid:true,domain:domainWithReference(data.map(row=>row[y]),referenceValue,null,true)},color:series?{range:t.categorical,legend:true}:undefined,marks});
}

export function heatmapChart(data, { x = "x", y = "y", value = "value", width = 640, height, xLabel = null, yLabel = null, theme = getTheme() } = {}) {
  const t=theme.chart,extent=numericExtent(data.map(d=>d[value]));
  const xDomain=[...new Set(data.map(d=>d[x]))],yDomain=[...new Set(data.map(d=>d[y]))];
  const plot=themedPlot(theme,{width,height,marginLeft:64,marginBottom:52,x:{label:xLabel??null,domain:xDomain},y:{label:yLabel??null,domain:yDomain},color:{type:"linear",range:t.sequential,domain:extent,legend:false},marks:[Plot.cell(data,{x,y,fill:value,inset:1,tip:true})]});
  const root=document.createElement("div");root.className="db-heatmap";root.append(plot);
  const legend=document.createElement("div");legend.className="db-heatmap-legend";
  const ramp=document.createElement("div");ramp.className="db-heatmap-ramp";ramp.style.background=`linear-gradient(90deg, ${t.sequential.join(", ")})`;
  const labels=document.createElement("div");labels.className="db-heatmap-domain";
  const lo=document.createElement("span"),hi=document.createElement("span");lo.textContent=fmt2.format(extent[0]);hi.textContent=fmt2.format(extent[1]);labels.append(lo,hi);
  legend.append(ramp,labels);root.append(legend);return root;
}

export function treemapChart(data, { label = "label", value = "value", parent = "parent", width = 640, height = 360, theme = getTheme() } = {}) {
  const t=theme.chart, groups=new Map();
  for(const row of data){
    const group=row[parent]==null||row[parent]===""?"":String(row[parent]);
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push({name:String(row[label]??"Unlabeled"),value:row[value]});
  }
  const children=[...groups].map(([name,items])=>name?{name,children:items}:items).flat();
  const root=hierarchy({name:"",children}).sum(d=>typeof d.value==="number"?d.value:0).sort((a,b)=>b.value-a.value);
  d3treemap().size([width,height]).paddingOuter(2).paddingInner(2)(root);
  const ns="http://www.w3.org/2000/svg", svgNode=document.createElementNS(ns,"svg");
  svgNode.setAttribute("width",String(width));svgNode.setAttribute("height",String(height));svgNode.setAttribute("viewBox",`0 0 ${width} ${height}`);
  svgNode.setAttribute("role","img");
  const colorIndex=new Map([...groups.keys()].map((k,i)=>[k||"",i]));
  for(const leaf of root.leaves()){
    const group=leaf.parent?.data.name||"", fill=t.categorical[(colorIndex.get(group)||0)%t.categorical.length];
    const rect=document.createElementNS(ns,"rect");rect.setAttribute("x",String(leaf.x0));rect.setAttribute("y",String(leaf.y0));rect.setAttribute("width",String(Math.max(0,leaf.x1-leaf.x0)));rect.setAttribute("height",String(Math.max(0,leaf.y1-leaf.y0)));rect.setAttribute("rx","2");rect.setAttribute("fill",fill);rect.setAttribute("stroke",t.card);rect.setAttribute("stroke-width","1");
    const titleNode=document.createElementNS(ns,"title");titleNode.textContent=`${leaf.data.name}: ${fmt2.format(leaf.value)}`;rect.append(titleNode);svgNode.append(rect);
    const w=leaf.x1-leaf.x0,h=leaf.y1-leaf.y0,maxChars=Math.floor((w-10)/7);
    if(w>=38&&h>=22&&maxChars>=2){const labelNode=document.createElementNS(ns,"text");labelNode.setAttribute("x",String(leaf.x0+5));labelNode.setAttribute("y",String(leaf.y0+Math.min(17,h/2+5)));labelNode.setAttribute("fill",textOn(fill,t));labelNode.setAttribute("font-family",t.fonts.body);labelNode.setAttribute("font-size","12");labelNode.textContent=leaf.data.name.length>maxChars?`${leaf.data.name.slice(0,maxChars-1)}…`:leaf.data.name;svgNode.append(labelNode);}
  }
  return svgNode;
}

export function dataTableChart(data, { sizing = "manual" } = {}) {
  const wrap=document.createElement("div");wrap.className=`db-data-table${sizing==="auto"?" db-data-table-auto":""}`;
  const scroll=document.createElement("div");scroll.className="db-data-table-scroll";scroll.setAttribute("role","region");scroll.setAttribute("aria-label","Data table");
  scroll.tabIndex=0;scroll.setAttribute("aria-description","Scroll horizontally for more columns and vertically for more rows.");
  const table=document.createElement("table");table.className="db-data-table-grid";
  const columns=[...new Set(data.flatMap(row=>Object.keys(row)))];
  // Put decision status first; ordinary scrolling can then reveal every
  // remaining column without a sticky cell covering its neighbours.
  const statusIndex=columns.findIndex(key=>key.toLowerCase()==="status");
  if(statusIndex>0)columns.unshift(...columns.splice(statusIndex,1));
  const hint=document.createElement("div");hint.className="db-data-table-hint";hint.textContent=`${columns.length} columns${statusIndex>=0?" · Status first":""} · Scroll ↔ for more`;
  const thead=document.createElement("thead"),head=document.createElement("tr");
  for(const key of columns){const th=document.createElement("th");th.scope="col";th.textContent=key;if(key.toLowerCase()==="status")th.className="db-data-table-status";head.append(th);}thead.append(head);
  const tbody=document.createElement("tbody");
  for(const row of data){const tr=document.createElement("tr");for(const key of columns){const td=document.createElement("td"),v=row[key];if(key.toLowerCase()==="status")td.className="db-data-table-status";td.textContent=v==null?"—":v instanceof Date?v.toISOString().slice(0,10):typeof v==="number"?(Number.isInteger(v)?fmtInt.format(v):fmt2.format(v)):String(v);tr.append(td);}tbody.append(tr);}
  table.append(thead,tbody);scroll.append(table);wrap.append(hint,scroll);return wrap;
}

export function textAnnotation(body = "") {
  const node=document.createElement("div");node.className="db-annotation";node.textContent=String(body);return node;
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
export function donutChart(data, { value, label, width = 420, height = width + 80, outerRadius = 150, innerRadius = 96, valueFormat = fmtInt.format.bind(fmtInt), theme = getTheme(), crossfilterField = null } = {}) {
  const t = theme.chart;
  const compactLegend = width < 280;
  width = Math.max(80, Math.min(width, height - 80, 400));
  data = donutParts(data, label, value);
  const total = data.reduce((s, d) => s + d[value], 0);
  const slices = d3pie().value((d) => d[value]).sort(null)(data);
  const arcGen = d3arc().innerRadius(innerRadius).outerRadius(outerRadius);
  const colors = data.map((_, i) => t.categorical[i % t.categorical.length]);
  const size = outerRadius * 2 + 48;
  const c = size / 2;
  // Keep the total readable when a narrow tile requires a smaller ring.
  const totalFont = Math.min(22, Math.max(12, width / 15)) * size / width;
  const textScale = size / width;
  return html`<div class="db-donut">
    ${svg`<svg width="${width}" height="${width}" viewBox="0 0 ${size} ${size}" role="img">
      <g transform="translate(${c} ${c})">
        ${slices.map((s, i) => {
          const sliceLabel = String(s.data[label]);
          const values = donutSourceLabels(s.data, label);
          const encoded = crossfilterField ? encodeURIComponent(JSON.stringify(values)) : "";
          return crossfilterField
            ? svg`<a href="#db-crossfilter:${encoded}" aria-label="${crossfilterAriaLabel(sliceLabel)}"><path d="${arcGen(s)}" fill="${colors[i]}" stroke="${t.card}" stroke-width="2" data-crossfilter-values="${encoded}"><title>${s.data[label]}: ${valueFormat(s.data[value])}</title></path></a>`
            : svg`<path d="${arcGen(s)}" fill="${colors[i]}" stroke="${t.card}" stroke-width="2"><title>${s.data[label]}: ${valueFormat(s.data[value])}</title></path>`;
        })}
        <text pointer-events="none" text-anchor="middle" dy="${-4 * textScale}" font-family="${t.fonts.mono}" font-weight="500" font-size="${totalFont}" fill="${t.ink}">${valueFormat(total)}</text>
        <text pointer-events="none" text-anchor="middle" dy="${12 * textScale}" font-size="${10 * textScale}" fill="${t.muted}">total</text>
      </g>
    </svg>`}
    <div class="db-legend ${compactLegend ? 'db-legend-compact' : ''}">
      ${data.map((d, i) => html`<span class="db-legend-item"><span class="db-swatch" style="background:${colors[i]}"></span><span class="db-legend-label">${d[label]}</span><span class="db-fig">${valueFormat(d[value])}</span></span>`)}
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
        <div class="db-kpi-value">${c.value == null ? '—' : c.value}</div>
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
@scope (:root[data-theme="paper"], :root:not([data-theme])) {
.chart-data { margin: 8px 0; overflow: auto; }
.chart-data table { border-collapse: collapse; width: 100%; font-size: 12px; }
.chart-data td, .chart-data th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--slate-200); }
.chart-data summary { cursor: pointer; }
.chart-data button { margin: 4px 8px; }
.chart-transform-note { color: var(--slate-600); font-size: 12px; }
.tile-chart .chart-transform-note { margin: 8px 0; }
.tile-chart svg a[data-crossfilter-selected="false"],
.tile-chart svg path[data-crossfilter-selected="false"] { opacity: .38; }
.tile-chart svg .db-time-brush { fill: var(--brush-fill); stroke: var(--periwinkle); stroke-width: 1.25; pointer-events: none; }
.db-data-table { min-width: 0; }
.db-data-table-scroll { max-width: 100%; max-height: min(60vh, 560px); overflow: auto; }
.db-data-table-grid { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.db-data-table-grid th, .db-data-table-grid td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--slate-200); white-space: nowrap; }
.db-data-table-grid th { position: sticky; top: 0; z-index: 1; background: var(--white); color: var(--slate-600); font-weight: 600; }
.db-data-table-grid td { font-variant-numeric: tabular-nums; }
svg [aria-label$="-axis tick label"], .chart-data summary { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.db-annotation { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); line-height: 1.45; padding: 4px; }
.db-heatmap-legend { margin: 2px 6% 4px 12%; }
.db-heatmap-ramp { height: 9px; border-radius: 6px; }
.db-heatmap-domain { display: flex; justify-content: space-between; color: var(--slate-600); font-size: 12px; margin-top: 3px; }
:focus-visible { outline: none; box-shadow: var(--shadow-focus) !important; }
  .db-card {
    background: var(--white);
    border: 1px solid var(--slate-200);
    border-radius: 10px;
    box-shadow: var(--shadow-card);
    padding: 24px;
    margin: 0 0 32px 0;
  }
  .db-eyebrow {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--slate-500);
    margin-bottom: 8px;
  }
  .db-chart-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 28px;
    line-height: 1.25;
    letter-spacing: 0.08em;
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
  .tile-chart .db-chart-title { font-size: 19px; line-height: 1.3; }
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
    box-shadow: var(--shadow-card);
    padding: 16px;
  }
  .db-kpi-value {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 28px;
    line-height: 1.25;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
  }
  .db-kpi-label {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--slate-500);
  }
  .db-kpi-delta { font-family: var(--font-mono); font-size: 14px; margin-top: 8px; }
  .db-delta-good { color: var(--success); }
  .db-delta-bad { color: var(--danger); }
  .db-donut { display: flex; flex-direction: column; align-items: center; }
  .db-legend {
    display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: center;
    margin-top: 12px; max-width: 560px;
  }
  .db-legend-item {
    display: inline-flex; align-items: center;
    font-family: var(--font-body); font-size: 14px; color: var(--slate-600);
  }
  .db-legend-item .db-fig { margin-left: 4px; white-space: nowrap; }
  .db-legend-compact { display: grid; align-self: stretch; gap: 4px; margin-top: 8px; }
  .db-legend-compact .db-legend-item { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 8px; align-items: start; font-size: 12px; line-height: 16px; }
  .db-legend-compact .db-swatch { margin: 2px 0 0; }
  .db-legend-compact .db-fig { margin: 0; }
  .db-legend-label { min-width: 0; }
  .db-swatch {
    display: inline-block; width: 12px; height: 12px; border-radius: 6px;
    margin-right: 8px;
  }
  .db-facets-scroll-hint { margin: 0 0 4px; font-size: 12px; color: var(--slate-600); }
  .db-facets { display: grid; gap: 28px 24px; margin-top: 4px; }
  .db-facet-label {
    font-family: var(--font-body); font-size: 12px; font-weight: 500;
    color: var(--slate-600); margin-bottom: 2px;
  } }
@scope (:root[data-theme]:not([data-theme="paper"])) {
.chart-data { margin: 8px 0; overflow: auto; }
.chart-data table { border-collapse: collapse; width: 100%; font-size: 12px; }
.chart-data td, .chart-data th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--slate-200); }
.chart-data summary { cursor: pointer; }
.chart-data button { margin: 4px 8px; }
.chart-transform-note { color: var(--slate-600); font-size: 12px; }
.tile-chart .chart-transform-note { margin: 8px 0; }
.tile-chart svg a[data-crossfilter-selected="true"] { filter: drop-shadow(0 0 3px var(--periwinkle)); }
.tile-chart svg a[data-crossfilter-selected="false"],
.tile-chart svg path[data-crossfilter-selected="false"] { opacity: .38; }
.tile-chart svg .db-time-brush { fill: rgb(62 92 118 / 14%); stroke: var(--periwinkle); stroke-width: 1.25; pointer-events: none; }
.db-data-table { min-width: 0; }
.db-data-table-scroll { max-width: 100%; max-height: min(60vh, 560px); overflow: auto; }
.db-data-table-grid { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
.db-data-table-grid th, .db-data-table-grid td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--slate-200); white-space: nowrap; }
.db-data-table-grid th { position: sticky; top: 0; z-index: 1; background: var(--white); color: var(--slate-600); font-weight: 600; }
.db-data-table-grid td { font-variant-numeric: tabular-nums; }
.db-annotation { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); line-height: 1.45; padding: 4px; }
.db-heatmap-legend { margin: 2px 6% 4px 12%; }
.db-heatmap-ramp { height: 9px; border-radius: 2px; }
.db-heatmap-domain { display: flex; justify-content: space-between; color: var(--slate-600); font-size: 11px; margin-top: 3px; }
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
    letter-spacing: 0.04em;
    color: var(--slate-500);
    margin-bottom: 8px;
  }
  .db-chart-title {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 28px;
    line-height: 1.25;
    letter-spacing: 0.08em;
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
    line-height: 1.25;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
  }
  .db-kpi-label {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0.04em;
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
  .db-legend-item .db-fig { margin-left: 4px; white-space: nowrap; }
  .db-legend-compact { display: grid; align-self: stretch; gap: 4px; margin-top: 8px; }
  .db-legend-compact .db-legend-item { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 8px; align-items: start; font-size: 12px; line-height: 16px; }
  .db-legend-compact .db-swatch { margin: 2px 0 0; }
  .db-legend-compact .db-fig { margin: 0; }
  .db-legend-label { min-width: 0; }
  .db-swatch {
    display: inline-block; width: 12px; height: 12px; border-radius: 3px;
    margin-right: 8px;
  }
  .db-facets-scroll-hint { margin: 0 0 4px; font-size: 12px; color: var(--slate-600); }
  .db-facets { display: grid; gap: 28px 24px; margin-top: 4px; }
  .db-facet-label {
    font-family: var(--font-body); font-size: 12px; font-weight: 500;
    color: var(--slate-600); margin-bottom: 2px;
  } }

/* S4: keep table navigation inside the tile. The cue remains visible even
   when the horizontal scrollbar is at the bottom of a tall table. */
.db-data-table { display: flex; flex-direction: column; min-height: 0; }
.db-data-table-hint { flex: none; padding: 4px 8px; font: 12px/1.4 var(--font-body); color: var(--slate-600); border-bottom: 1px solid var(--slate-200); }
.db-data-table-scroll { flex: 1 1 auto; min-height: 0; }
.tile-chart > .db-data-table:not(.db-data-table-auto) { height: 100%; }
.tile-chart > .db-data-table:not(.db-data-table-auto) > .db-data-table-scroll { max-height: none; }
@media print {
  .db-data-table-hint { display: none; }
}
</style>`;
