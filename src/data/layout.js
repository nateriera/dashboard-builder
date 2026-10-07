import { ROW_HEIGHT } from '../tiles/geometry.js';
import { TILE_TYPES, DATASETS } from '../tiles/registry.js';
import { THEMES } from '../themes/themes.js';
import { LIMITS, assertRows } from './limits.js';
import { validateFilters } from './filters.js';
import { validateParameters } from './parameters.js';

const own = (o,k) => Object.hasOwn(o,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = msg => { throw new Error(msg); };
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const text = (v, name, max = 500) => typeof v === 'string' && v.length <= max ? v : fail(`Invalid ${name}.`);
function ref(v, query = true) {
  if (v === null) return null;
  if (typeof v !== 'string') fail('Invalid data reference.');
  if (own(DATASETS,v)) return v;
  const m = /^(upload|query):([a-zA-Z0-9_-]{1,100})$/.exec(v);
  if (!m || (!query && m[1] === 'query')) fail(`Invalid data reference: ${v}`);
  return v;
}
function strings(v, name) {
  if (!Array.isArray(v) || v.length > LIMITS.columns || v.some(s => typeof s !== 'string' || s.length > 200 || ['__proto__','constructor','prototype'].includes(s)) || new Set(v).size !== v.length) fail(`Invalid ${name}.`);
  return [...v];
}
function mapping(v, columns) {
  if (!object(v)) fail('Invalid column mapping.');
  const out = {};
  for (const [k,c] of Object.entries(v)) {
    if (!['label','value','date','series','x','y','group','id','facet','delta','deltaDir'].includes(k) || !columns.includes(c)) fail('Invalid column mapping.');
    out[k] = c;
  }
  return out;
}
function records(v, kind) {
  if (v === undefined) return {};
  if (!object(v) || Object.keys(v).length > 100) fail(`Invalid ${kind} records.`);
  const out = {};
  for (const [id,e] of Object.entries(v)) {
    if (!idPattern.test(id) || ['__proto__','constructor','prototype'].includes(id) || !object(e)) fail(`Invalid ${kind} id or record.`);
    const columns = strings(e.columns || [], 'columns');
    const fieldKeys = strings(e.fieldKeys || [], 'field keys');
    const name = text(e.name || id, 'record name');
    const map = mapping(e.mapping || {}, columns);
    if (kind === 'dataset') {
      assertRows(e.rows);
      if (e.raw != null) {
        if (!object(e.raw)) fail('Invalid raw data.');
        strings(e.raw.columns, 'raw columns'); assertRows(e.raw.rows);
      }
      out[id] = { name, columns, fieldKeys, mapping: map, rows: e.rows, raw: e.raw || null };
    } else {
      const sql = text(e.sql, 'SQL', 100000);
      const dependencies = e.dependencies === undefined ? null : e.dependencies;
      if (dependencies !== null && (!Array.isArray(dependencies) || dependencies.some(r => ref(r, false) === null))) fail('Invalid query dependencies.');
      out[id] = { name, sql, columns, fieldKeys, mapping: map, dependencies };
    }
  }
  return out;
}

/** Side-effect-free validation/migration. V1 references always remain explicit:
 * the old format cannot distinguish intent, so guessing a follower is unsafe. */
export function validateLayout(input) {
  if (!object(input) || input.app !== 'dashboard-builder' || ![1,2,3].includes(input.version)) fail('Unsupported layout app or version.');
  if (new TextEncoder().encode(JSON.stringify(input)).length > LIMITS.layoutBytes) fail('Layout exceeds the 32 MiB limit.');
  if (!Array.isArray(input.tiles) || input.tiles.length > LIMITS.tiles) fail('Invalid tiles or too many tiles (limit 100).');
  const data = structuredClone(input);
  if (data.version === 3 && data.rowHeight !== ROW_HEIGHT) fail("Unsupported grid row height.");
  const scale = data.version < 3 ? 3 : 1;
  const dd = data.defaultDataset || { kind: 'samples' };
  if (!object(dd) || !['samples','dataset'].includes(dd.kind)) fail('Invalid dashboard default.');
  const defaultDataset = dd.kind === 'samples' ? { kind: 'samples' } : { kind: 'dataset', ref: ref(dd.ref, false) };
  if (defaultDataset.kind === 'dataset' && defaultDataset.ref === null) fail('Dashboard data reference required.');
  const theme = data.theme || 'paper';
  if (!THEMES.some(t => t.id === theme)) fail('Unknown theme.');
  const ids = new Set();
  const tiles = data.tiles.map((t,i) => {
    if (!object(t) || !own(TILE_TYPES,t.type)) fail(`Unknown tile type: ${t?.type}`);
    const e = TILE_TYPES[t.type];
    const id = t.id ?? `import-${i}`;
    if (!idPattern.test(id) || ids.has(id)) fail('Invalid or duplicate tile id.');
    ids.add(id);
    const geometry = { x: t.x ?? 0, y: t.y ?? i * 18 / scale, w: t.w ?? e.defaultSize.w, h: t.h ?? e.defaultSize.h / scale };
    for (const [k,n] of Object.entries(geometry)) if (!Number.isInteger(n) || n < (['w','h'].includes(k) ? 1 : 0) || n > (['x','w'].includes(k) ? 12 : (data.version === 3 ? 3000 : 1000))) fail('Invalid tile geometry.');
    geometry.y *= scale; geometry.h *= scale;
    const sizing = t.sizing ?? 'manual';
    if (!['auto','manual'].includes(sizing)) fail('Invalid sizing intent.');
    if (geometry.x + geometry.w > 12) fail('Tile exceeds grid width.');
    const dataset = ref(t.dataset ?? null);
    const binding = e.noData
      ? (data.version >= 2 ? t.binding : {mode:'none'})
      : data.version >= 2 ? t.binding : { mode: dataset === null ? 'dashboard' : 'explicit', ...(dataset === null ? {} : { ref: dataset }) };
    if (e.noData) {
      if (!object(binding) || binding.mode !== 'none' || dataset !== null || Object.keys(binding).length !== 1) fail('Invalid no-data tile binding.');
    } else if (!object(binding) || !['dashboard','explicit'].includes(binding.mode) || (binding.mode === 'explicit' && (ref(binding.ref) === null || binding.ref !== dataset)) || (binding.mode === 'dashboard' && dataset !== null)) fail('Invalid or inconsistent binding.');
    const opts = t.tileOptions ?? {};
    if (!object(opts)) fail('Invalid chart options.');
    const tileOptions = {};
    for (const [k,v] of Object.entries(opts)) {
      if (['xLabel','yLabel'].includes(k)) tileOptions[k] = text(v, 'axis label', 120);
      else if (['trend','diverging','includeZero'].includes(k) && typeof v === 'boolean') tileOptions[k] = v;
      else if (k === 'crossfilterMode' && ['filter','highlight','none'].includes(v) && e.crossfilterField) tileOptions[k] = v;
      else if (k === 'clickAction' && ['filter-and-inspect','filter-only','inspect-only'].includes(v) && e.crossfilterField) tileOptions[k] = v;
      else if (k === 'body' && e.noData) tileOptions.body = text(v,'annotation',10000);
      else if (k === 'mode' && ['stacked','grouped'].includes(v) && ['stackedBar','stackedColumn'].includes(t.type)) tileOptions.mode = v;
      else if (k === 'binCount' && Number.isInteger(v) && v >= 5 && v <= 100 && t.type === 'histogram') tileOptions.binCount = v;
      else if (k === 'sort' && ['desc','asc','data'].includes(v) && ['bar','column','dot'].includes(t.type)) tileOptions.sort = v;
      else if (k === 'topN' && Number.isInteger(v) && v >= 1 && v <= 100 && ['bar','column','dot','stackedBar','stackedColumn'].includes(t.type)) tileOptions.topN = v;
      else if (k === 'referenceValue' && typeof v === 'number' && Number.isFinite(v) && ['bar','column','dot','line','area','scatter','histogram','boxplot'].includes(t.type)) tileOptions.referenceValue = v;
      else if (k === 'referenceLabel' && ['bar','column','dot','line','area','scatter','histogram','boxplot'].includes(t.type)) tileOptions.referenceLabel = text(v,'reference label',120);
      else fail(`Unsupported chart option: ${k}`);
    }
    return { id, type: t.type, title: text(t.title ?? e.defaultTitle,'title'), source: text(t.source ?? 'Sample data','source'), dataset, binding, tileOptions, sizing, ...geometry };
  });
  const datasets = records(data.datasets,'dataset'), queries = records(data.queries,'query');
  for (const t of tiles) {
    const fields = TILE_TYPES[t.type].fields;
    const q = t.dataset?.startsWith('query:') ? queries[t.dataset.slice(6)] : null;
    if (q && fields.some(f => !f.optional && !q.mapping[f.key])) fail(`Query mapping is incomplete for ${t.type}.`);
    const ds = t.dataset?.startsWith('upload:') ? datasets[t.dataset.slice(7)] : null;
    if (ds) for (const row of ds.rows) {
      for (const f of fields) {
        if (!f.optional && !own(row,f.key)) fail(`Uploaded rows are missing ${f.key} for ${t.type}.`);
        if (f.numeric && row[f.key] != null && typeof row[f.key] !== 'number') fail(`Uploaded ${f.key} must be a finite number for ${t.type}.`);
      }
    }
  }
  const filters = validateFilters(data.filters);
  const tileIds = new Set(tiles.map(tile => tile.id));
  if (filters.some(filter => filter.targets?.some(target => !tileIds.has(target.tileId)))) fail('Filter connection references a missing tile.');
  const parameters = validateParameters(data.parameters);
  return { app: 'dashboard-builder', version: 3, rowHeight: ROW_HEIGHT, theme, defaultDataset, filters, parameters, tiles, datasets, queries };
}

export function assertNoCollisions(candidate, getDataset, getQuery) {
  for (const [kind,get] of [['datasets',getDataset],['queries',getQuery]]) {
    for (const [id,e] of Object.entries(candidate[kind])) {
      const old = get(id);
      if (!old) continue;
      // Persistence-only fields do not affect identity.
      if (Object.keys(e).some(k => JSON.stringify(old[k] ?? null) !== JSON.stringify(e[k] ?? null))) fail(`Conflicting ${kind} id ${id}. Import cancelled; existing data retained.`);
    }
  }
}
