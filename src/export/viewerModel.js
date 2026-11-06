// Pure helpers for the exported viewer (UX-7). No DOM access, so the node
// suite can cover metadata fallbacks, scope tests, row packing and the print
// summary without a browser.

import { exportMetaFacts, metaFromInputs, validateLayoutMeta, META_FIELDS, META_MAX_LENGTH } from '../data/layoutMeta.js';
export { exportMetaFacts, metaFromInputs, validateLayoutMeta, META_FIELDS, META_MAX_LENGTH };

const presentText = value => (typeof value === 'string' ? value.trim() : '');

/**
 * Title-block fact lines (empty-state parity with the composer): a blank
 * Prepared by or Data period prints no line at all; present values print as
 * "Label: value" in a fixed order.
 */
export function exportFactLines(meta) {
  return [['Prepared by', presentText(meta?.preparedBy)], ['Data period', presentText(meta?.dataPeriod)]]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
}

/** A tile's source line, or null when the source is empty (the composer shows none). */
export function tileSourceLine(source) {
  const value = presentText(source);
  return value ? `Source: ${value}` : null;
}

const pad = n => String(Math.abs(Math.trunc(n))).padStart(2, '0');

/**
 * Format the export instant as YYYY-MM-DD HH:mm:ss UTC±HH:mm in the given
 * offset (minutes east of UTC, i.e. -Date#getTimezoneOffset()).
 */
export function formatExportStamp(iso, offsetMinutes = 0) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const offset = Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : 0;
  const shifted = new Date(time + offset * 60000);
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const clock = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
  const sign = offset < 0 ? '-' : '+';
  return `${date} ${clock} UTC${sign}${pad(Math.abs(offset) / 60)}:${pad(Math.abs(offset) % 60)}`;
}

/**
 * Whether a filter acts on a tile, mirroring applyFilters' own skip rules
 * (scope, chart connections, field presence). Crossfilters never act on
 * their source tile.
 */
export function filterAppliesToTile(filter, tile) {
  if (!tile || !Array.isArray(tile.rows)) return false;
  if (filter.source === 'crossfilter' && filter.sourceTile === tile.id) return false;
  if (filter.scope === 'page' && filter.pageId !== tile.pageId) return false;
  const connection = filter.targets?.find(target => target.tileId === tile.id);
  if (filter.targets && !connection) return false;
  const field = connection?.field || filter.field;
  return tile.rows.some(row => row && Object.hasOwn(row, field));
}

/** Whether a filter does anything on a page: it acts on at least one of the page's tiles. */
export function filterAppliesToPage(filter, pageId, tiles) {
  return tiles.some(tile => tile.pageId === pageId && filterAppliesToTile(filter, tile));
}

/** A crossfilter selection is shown on its source tile's page and on every page it acts on. */
export function crossfilterShownOnPage(filter, pageId, tiles) {
  const source = tiles.find(tile => tile.id === filter.sourceTile);
  return source?.pageId === pageId || filterAppliesToPage(filter, pageId, tiles);
}

/**
 * Pack editor-grid tiles into content-height rows (V5). Each distinct
 * editor y-start becomes one auto-height grid row; a tile spans the rows
 * whose starts fall inside its editor extent, so column spans and
 * side-by-side arrangement survive while empty editor rows and fixed tile
 * heights do not.
 */
export function packTileRows(tiles) {
  const starts = [...new Set(tiles.map(tile => tile.y))].sort((a, b) => a - b);
  const placement = new Map();
  for (const tile of tiles) {
    const start = starts.indexOf(tile.y);
    let end = start + 1;
    while (end < starts.length && starts[end] < tile.y + tile.h) end++;
    placement.set(tile, { rowStart: start + 1, rowEnd: end + 1 });
  }
  return placement;
}

const RELATIVE_PRESET_LABELS = {
  'last-7-days': 'Last 7 days',
  'last-30-days': 'Last 30 days',
  'month-to-date': 'Month to date',
  'last-month': 'Last month',
  'year-to-date': 'Year to date'
};
export const relativePresetLabel = preset => RELATIVE_PRESET_LABELS[preset] || preset;

const show = value => (value == null ? '(blank)' : String(value));

/** Value text for one filter in the print summary. */
export function describeFilterValue(filter) {
  if (filter.op === 'date-between' && filter.relativePreset) return relativePresetLabel(filter.relativePreset);
  if (filter.op === 'between' || filter.op === 'date-between') return filter.values.length === 2 ? `${show(filter.values[0])}–${show(filter.values[1])}` : 'All';
  if (!filter.values.length) return 'All';
  const list = filter.values.map(show).join(', ');
  return filter.op === 'is-not' ? `not ${list}` : list;
}

/** "Filters at print time: {label}: {value}; …" or null when nothing applies. */
export function printFilterSummary(entries) {
  if (!entries.length) return null;
  return `Filters at print time: ${entries.map(({ label, value }) => `${label}: ${value}`).join('; ')}`;
}

const filterKey = filter => JSON.stringify([filter.id, filter.values, filter.relativePreset ?? null]);
const crossKey = filter => JSON.stringify([filter.sourceTile, filter.field, filter.op, filter.values]);

/** Whether the viewer's working state equals the exported (or active view's) state. */
export function viewerStateEquals({ filters, parameters }, { filters: baseFilters, parameters: baseParameters }) {
  const editable = list => list.filter(filter => filter.source !== 'crossfilter');
  const cross = list => list.filter(filter => filter.source === 'crossfilter').map(crossKey).sort();
  const baseById = new Map(editable(baseFilters).map(filter => [filter.id, filterKey(filter)]));
  if (editable(filters).some(filter => baseById.has(filter.id) && baseById.get(filter.id) !== filterKey(filter))) return false;
  if (JSON.stringify(cross(filters)) !== JSON.stringify(cross(baseFilters))) return false;
  const baseValues = new Map((baseParameters || []).map(parameter => [parameter.name, JSON.stringify(parameter.value ?? null)]));
  return (parameters || []).every(parameter => !baseValues.has(parameter.name) || baseValues.get(parameter.name) === JSON.stringify(parameter.value ?? null));
}
