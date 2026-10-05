// Render sweep: all 18 tile types x all 4 themes through the export render path.
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://localhost/" });
for (const k of ["window","document","HTMLElement","SVGElement","Element","Node","NodeList","HTMLCollection","CustomEvent","getComputedStyle","requestAnimationFrame","indexedDB","devicePixelRatio"]) {
  try { if (dom.window[k] !== undefined) globalThis[k] = dom.window[k]; } catch { /* read-only global */ }
}
globalThis.window.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
if (!globalThis.localStorage) {
  const s = new Map();
  globalThis.localStorage = { getItem:(k)=>s.get(k)??null, setItem:(k,v)=>s.set(k,String(v)), removeItem:(k)=>s.delete(k) };
}

const { TILE_TYPES } = await import("../src/tiles/registry.js");
const { setTheme, THEMES, getTheme } = await import("../src/themes/themes.js");
const { normalizeRows } = await import("../src/tiles/normalize.js");
const load = (n) => JSON.parse(readFileSync(join(ROOT, "src", "data", n), "utf8"));

const CASES = [
  ["bar", "categorical.json"], ["column", "categorical.json"], ["line", "timeseries.json"],
  ["scatter", "scatter.json"], ["dot", "categorical.json"], ["donut", "categorical.json"],
  ["choropleth", "states.json"], ["smallMultiples", "facets.json"], ["kpi", "kpis.json"],
  ["table", "categorical.json"], ["text", null], ["stackedBar", "stacked.json"], ["stackedColumn", "stacked.json"],
  ["histogram", "scatter.json"], ["boxplot", "boxdata.json"], ["area", "timeseries.json"], ["heatmap", "heatmap.json"], ["treemap", "treemap.json"]
];
const key = { bar:"categorical", column:"categorical", line:"timeseries", scatter:"scatter", dot:"categorical", donut:"categorical", choropleth:"states", smallMultiples:"facets", kpi:"kpis", table:"categorical", text:null, stackedBar:"stacked", stackedColumn:"stacked", histogram:"scatter", boxplot:"boxdata", area:"timeseries", heatmap:"heatmap", treemap:"treemap" };

let fails = 0;
for (const theme of THEMES) {
  setTheme(theme.id);
  const active = getTheme();
  if (active.id !== theme.id) { console.log(`THEME SWITCH FAIL: ${theme.id}`); fails++; continue; }
  // sanity: theme tokens are real colors
  for (const c of active.chart.categorical) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) { console.log(`BAD COLOR ${c} in ${theme.id}`); fails++; }
  }
  for (const [type, file] of CASES) {
    const entry = TILE_TYPES[type];
    const rows = file ? load(file) : [];
    if (type === "choropleth") {
      var topo = load("us-states-10m.json");
    }
    const el = document.createElement("div");
    el.style.width = "800px"; el.style.height = "500px";
    document.body.appendChild(el);
    try {
      if (type === "kpi") {
        entry.render(el, { data: rows.map((d) => ({ value: String(d.value ?? d.requests ?? ""), label: d.label ?? d.category ?? "" })), options: { title: "t" } });
      } else if (type === "text") {
        entry.render(el, { data: [], options: { title: "t", tileOptions: { body: "Synthetic annotation" } } });
      } else {
        entry.render(el, { data: rows, options: { title: "t", tileOptions: type.startsWith('stacked') ? {mode:'stacked'} : {} } });
      }
      const ok = type === "kpi" ? el.querySelector(".db-kpi-row") : type === "table" ? el.querySelector(".db-data-table") : type === "text" ? el.querySelector(".db-annotation") : el.querySelector("svg");
      console.log(`${theme.id} / ${type}: ${ok ? "OK" : "NO SVG"}`);
      if (!ok) fails++;
    } catch (e) {
      console.log(`${theme.id} / ${type}: FAIL ${e.message}`);
      fails++;
    }
    el.remove();
  }
}
console.log(fails === 0 ? "ALL 72 OK" : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);
