// Row height includes GridStack's inset gutters; legacy rows were 72px.
export const ROW_HEIGHT = 24;
export const LEGACY_ROW_HEIGHT = 72;
export const GRID_MARGIN = 12;
export function rowsForContent(height, rowHeight = ROW_HEIGHT, margin = GRID_MARGIN) {
  return Math.max(3, Math.ceil((height + margin * 2) / rowHeight));
}
// Keep comparisons on one row. Narrow tiles scroll rather than wrap or
// compress panels below the readable width used by the fit census.
export function facetGeometry(width, count) {
  const columns = Math.max(1, count);
  const panelWidth = Math.max(244, Math.floor((width - 24 * (columns - 1)) / columns));
  return { columns, panelWidth, width: columns * panelWidth + 24 * (columns - 1) };
}
