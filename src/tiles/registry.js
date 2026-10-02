import { facetColumns } from './geometry.js';
import { renderData } from "../charts/integrity.js";
import { chartData } from "../ui/chartData.js";
// Tile registry: the catalog of chart types the composer can place on the grid.
//
// Each entry describes one tile type:
//   type           - stable key used in layout JSON
//   label          - human-readable name shown in the palette
//   description    - one-line palette subtitle
//   datasets       - dataset keys this tile can render (see DATASETS below)
//   defaultDataset - dataset selected for a fresh tile
//   defaultSize    - GridStack {w, h} for a fresh tile (12-column grid)
//   defaultTitle   - initial tile title (editable in the tile toolbar)
//   controls       - optional extra toolbar controls, e.g. checkboxes
//   render(el, {data, options}) - mounts the chart into el.
//     el is the .tile-chart container; measure el.clientWidth and pass it as
//     the chart width so tiles re-render crisply at their grid size.
//     options = {title, source, tileOptions} where tileOptions holds the
//     per-tile control values (e.g. {trend: true}).

import {
  barChart,
  columnChart,
  lineChart,
  scatterChart,
  dotChart,
  donutChart,
  choropleth,
  smallMultiples,
  kpiRow,
  card
} from "../charts/charts.js";

import categorical from "../data/categorical.json";
import timeseries from "../data/timeseries.json";
import scatter from "../data/scatter.json";
import kpis from "../data/kpis.json";
import states from "../data/states.json";
import facets from "../data/facets.json";
import usStates from "../data/us-states-10m.json";

// Sample datasets shipped with the app. Later phases will let tiles bind
// their own data (CSV/JSON upload, then DuckDB-WASM queries).
// states: synthetic per-state values (FIPS ids) for the choropleth sample;
// usStates is the TopoJSON topology the choropleth renders against.
export const DATASETS = { categorical, timeseries, scatter, kpis, states, facets };

export const DATASET_LABELS = {
  categorical: "Categories (8)",
  timeseries: "Monthly series (2)",
  scatter: "Scatter points (24)",
  kpis: "KPI cards (4)",
  states: "States — sample values (51)",
  facets: "Facets — 3 groups × 5 categories (15)"
};

// Pure normalization helpers live in ./normalize.js (no DOM/kit imports, so
// they're unit-testable in node); re-exported here for tile authors.
import { guessMapping, normalizeRows, promoteDate } from "./normalize.js";
export { guessMapping, normalizeRows, promoteDate };

// Mount helper for Plot-based charts: clears el, renders the chart function
// at the container's measured width, height, and wraps it in a themed card carrying
// the tile title and source line. Charts read the active theme themselves
// (see src/charts/charts.js), so a theme switch just re-renders the tiles.
function mount(el, chartFn, options) {
  el.replaceChildren();
  const frame = card(document.createElement('span'), { title: options.hideTitle ? null : options.title, source: options.source });
  el.append(frame);
  const width = Math.max(120, (el.clientWidth || 640) - 32);
  const chrome = frame.querySelector('.db-chart-head').offsetHeight + (frame.querySelector('.db-chart-source')?.offsetHeight || 0) + 48;
  const preferred = options.preferredHeight || 260;
  const height = options.sizing === 'auto' || !el.clientHeight ? preferred : Math.max(100, el.clientHeight - chrome - (options.footerHeight ?? 40) - (options.legendSpace || 0));
  frame.querySelector('.db-chart-body').replaceChildren(chartFn(width, height));
}

export const TILE_TYPES = {
  bar: {
    label: "Bar chart",
    description: "Ranked horizontal bars",
    // Data contract: declares what this tile needs. The upload flow builds its
    // column-mapping UI from these declarations (never hardcoded per type).
    // Uploaded files are normalized to rows keyed by field `key`, so render()
    // below keeps working unchanged.
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => barChart(data, { x: "value", y: "label", width, height, xLabel: options.tileOptions?.xLabel || null }),
        options
      );
    }
  },

  column: {
    label: "Column chart",
    description: "Vertical bars by category",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => columnChart(data, { x: "label", y: "value", width, height, yLabel: options.tileOptions?.yLabel || null }),
        options
      );
    }
  },

  line: {
    label: "Line chart",
    description: "Monthly time series",
    fields: [
      { key: "date", label: "X column — dates or categories" },
      { key: "value", label: "Value column", numeric: true },
      { key: "series", label: "Series column", optional: true }
    ],
    datasets: ["timeseries"],
    defaultDataset: "timeseries",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Monthly requests",
    render(el, { data, options }) {
      // Promote "YYYY-MM" strings to Date so Plot uses a time axis.
      const rows = data.map((d) => ({ ...d, date: promoteDate(d.date) }));
      mount(
        el,
        (width, height) =>
          lineChart(rows, { x: "date", y: "value", stroke: "series", width, height, yLabel: options.tileOptions?.yLabel || null }),
        options
      );
    }
  },

  scatter: {
    label: "Scatter plot",
    description: "X/Y relationship, optional trend",
    fields: [
      { key: "x", label: "X column", numeric: true },
      { key: "y", label: "Y column", numeric: true },
      { key: "group", label: "Group column", optional: true }
    ],
    datasets: ["scatter"],
    defaultDataset: "scatter",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Rent burden vs. homelessness rate",
    controls: [{ key: "trend", label: "Trend line", type: "checkbox", default: true }],
    render(el, { data, options }) {
      const trend = options.tileOptions?.trend ?? true;
      mount(
        el,
        (width, height) =>
          scatterChart(data, {
            x: "x",
            y: "y",
            fill: "group",
            trend,
            width, height,
            xLabel: options.tileOptions?.xLabel || null,
            yLabel: options.tileOptions?.yLabel || null
          }),
        options
      );
    }
  },

  dot: {
    label: "Dot plot",
    description: "Lollipop alternative to bars",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 6, h: 5 },
    defaultTitle: "Requests by category",
    render(el, { data, options }) {
      mount(
        el,
        (width, height) => dotChart(data, { x: "value", y: "label", width, height, xLabel: options.tileOptions?.xLabel || null }),
        options
      );
    }
  },

  donut: {
    label: "Donut chart",
    description: "Parts of a whole (≤6 slices)",
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["categorical"],
    defaultDataset: "categorical",
    defaultSize: { w: 4, h: 6 },
    defaultTitle: "Share of requests",
    render(el, { data, options }) {
      mount(
        el,
        // The donut is square; cap the width so wide tiles don't blow it up.
        (width, height) =>
          donutChart(data, {
            value: "value",
            label: "label",
            width: Math.min(width, 400), height
          }),
        options
      );
    }
  },

  choropleth: {
    label: "Choropleth map",
    description: "US states shaded by value",
    // The id column is text: FIPS codes ("06") must keep their leading zero,
    // so it is deliberately NOT numeric. Uploads with a FIPS-like column map
    // here; the sample dataset uses the bundled us-states topology.
    fields: [
      { key: "id", label: "ID column (FIPS codes)" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["states"],
    defaultDataset: "states",
    defaultSize: { w: 8, h: 6 },
    defaultTitle: "Value by state",
    controls: [{ key: "diverging", label: "Diverging scale", type: "checkbox", default: false }],
    render(el, { data, options }) {
      const diverging = options.tileOptions?.diverging ?? false;
      mount(
        el,
        (width, height) =>
          choropleth(data, {
            geo: usStates,
            object: "states",
            id: "id",
            value: "value",
            diverging,
            width, height
          }),
        options
      );
    }
  },

  smallMultiples: {
    label: "Small multiples",
    description: "Faceted column charts, shared scale",
    // The kit's smallMultiples() takes a chart-builder callback; this tile
    // fixes the inner chart to columns and wires the shared y-domain through,
    // which is what keeps every panel honest.
    fields: [
      { key: "facet", label: "Facet column (one panel each)" },
      { key: "label", label: "Category column" },
      { key: "value", label: "Value column", numeric: true }
    ],
    datasets: ["facets"],
    defaultDataset: "facets",
    defaultSize: { w: 12, h: 6 },
    defaultTitle: "Requests by category and region",
    controls: [
      { key: "includeZero", label: "Include zero in shared scale", type: "checkbox", default: true }
    ],
    render(el, { data, options }) {
      const includeZero = options.tileOptions?.includeZero ?? true;
      mount(
        el,
        (width, height) => {
          const count = new Set(data.map(d => d.facet)).size;
          const columns = facetColumns(width, count);
          const chartWidth = Math.floor((width - 24 * (columns - 1)) / columns);
          const chartHeight = Math.max(100, height / Math.ceil(count / columns) - 44);
          return smallMultiples(data, {
            facet: "facet",
            value: "value",
            columns,
            includeZero,
            chartWidth,
            chart: (rows, { yDomain, width: cw }) =>
              columnChart(rows, { x: "label", y: "value", width: cw, height: chartHeight, yDomain, yLabel: options.tileOptions?.yLabel || null })
          });
        },
        options
      );
    }
  },

  kpi: {
    label: "KPI row",
    description: "Headline metric cards",
    // KPI values render as given text (format them in your data: "$1,287",
    // "13.6", "0.334"). deltaDir accepts "up"/"down"; when a delta is mapped
    // without a direction, the sign is derived automatically.
    fields: [
      { key: "label", label: "Label column" },
      { key: "value", label: "Value column" },
      { key: "delta", label: "Change text", optional: true },
      { key: "deltaDir", label: "Direction (up/down)", optional: true }
    ],
    datasets: ["kpis"],
    defaultDataset: "kpis",
    defaultSize: { w: 12, h: 2 },
    defaultTitle: "Headlines",
    render(el, { data, options }) {
      // KPI cards carry their own layout; no width plumbing needed.
      el.innerHTML = "";
      el.appendChild(card(kpiRow(data), { title: options.hideTitle ? null : options.title, source: options.source }));
    }
  }
};

const lastRender = new WeakMap();
export function resizeTileChart(el, options = {}) {
  // An unavailable/loading state must never resurrect a previous dataset.
  if (!el?.querySelector('.db-card')) return;
  const last = lastRender.get(el);
  if (last) TILE_TYPES[last.type].render(el, { data: last.data, options: { ...last.options, ...options, resizeOnly: true } });
}

// One integrity boundary for both composer and standalone exports.
for (const [type, entry] of Object.entries(TILE_TYPES)) {
  entry.defaultSize.h *= 3;
  const render = entry.render;
  entry.render = (el, { data, options = {} }) => {
    const previousDetails = options.resizeOnly ? el.querySelector('.chart-data') : null;
    lastRender.set(el, { type, data, options });
    options = { ...options, preferredHeight: type === 'bar' || type === 'dot' ? Math.min(600, Math.max(220, data.length * 24 + 50)) : type === 'donut' ? 340 : 260, legendSpace: options.legendSpace ?? (type === 'line' ? 32 : 0) };
    try {
      for (const f of entry.fields.filter(f => f.numeric)) {
        for (const r of data) {
          const v = r[f.key];
          if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw new Error('Unsupported numeric precision or type in ' + f.key + '. Use a KPI/text field or explicitly round in SQL.');
        }
      }
      const prepared = renderData(type,data);
      render(el,{ data: prepared.rows, options });
      if (prepared.note || (type === 'smallMultiples' && options.tileOptions?.includeZero === false)) {
        const note = document.createElement('p'); note.className = 'chart-transform-note';
        note.textContent = prepared.note || 'Cropped shared domain selected: zero may be excluded.'; el.append(note);
      }
      for (const svg of el.querySelectorAll('svg')) { svg.setAttribute('role','img'); svg.setAttribute('aria-label',options.title || entry.label); }
    } catch (err) {
      el.replaceChildren(); const error = document.createElement('div'); error.className = 'tile-error'; error.setAttribute('role','alert'); error.textContent = err.message; el.append(error);
    }
    el.append(previousDetails || chartData(data,entry.fields,options.title));
    if (options.sizing !== 'auto' && el.clientHeight && el.querySelector('.db-card')) {
      const extras = [...el.children].filter(node => !node.classList.contains('db-card'));
      const footerHeight = extras.reduce((sum, node) => {
        const css = getComputedStyle(node);
        return sum + node.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
      }, 0);
      let legendSpace = 0;
      if (type === 'donut') {
        const legend = el.querySelector('.db-legend');
        legendSpace = Math.max(0, legend.getBoundingClientRect().height + parseFloat(getComputedStyle(legend).marginTop) - 80);
      } else if (type === 'line') {
        const figure = el.querySelector('figure');
        const plot = figure && [...figure.querySelectorAll('svg')].sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        if (plot) legendSpace = figure.getBoundingClientRect().height - plot.getBoundingClientRect().height;
      }
      if (Math.abs(footerHeight - (options.footerHeight ?? 40)) > 1 || Math.abs(legendSpace - (options.legendSpace || 0)) > 1) {
        options = { ...options, footerHeight, legendSpace };
        render(el, { data: renderData(type,data).rows, options });
        el.append(...extras);
        for (const svg of el.querySelectorAll('svg')) { svg.setAttribute('role','img'); svg.setAttribute('aria-label', options.title || entry.label); }
      }
      lastRender.set(el, {type, data, options});
    }
  };
}
