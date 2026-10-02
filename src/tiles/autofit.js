import { rowsForContent } from './geometry.js';
// Measure intrinsic card content, not a nested scroll viewport. Gutters are
// inside GridStack's row geometry, never added to the height of every row.
export function fitTileToContent(grid, el) {
  if (!el?.isConnected || !el.gridstackNode || el.classList.contains('ui-resizable-resizing') || document.body.classList.contains('present')) return;
  const toolbar = el.querySelector('.tile-toolbar');
  const chart = el.querySelector('.tile-chart');
  if (!chart?.firstElementChild) return;
  const content = [...chart.children].reduce((sum, child) => {
    const style = getComputedStyle(child);
    return sum + child.getBoundingClientRect().height + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
  }, 0);
  const rows = rowsForContent(content + (toolbar?.offsetHeight || 0), grid.getCellHeight(), grid.getMargin());
  if (el.gridstackNode.h !== rows) grid.update(el, { h: rows });
}
