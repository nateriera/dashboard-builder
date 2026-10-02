// Row height includes GridStack's inset gutters; legacy rows were 72px.
export const ROW_HEIGHT = 24;
export const LEGACY_ROW_HEIGHT = 72;
export const GRID_MARGIN = 12;
export function rowsForContent(height, rowHeight = ROW_HEIGHT, margin = GRID_MARGIN) {
  return Math.max(3, Math.ceil((height + margin * 2) / rowHeight));
}
export function facetColumns(width, count) {
  return Math.max(1, Math.min(count, 3, Math.floor((width + 24) / 244)));
}
