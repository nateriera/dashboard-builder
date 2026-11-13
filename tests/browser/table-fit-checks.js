// Browser geometry probe shared by the regression specs and fit census.
export function tableFitProbe(scroll) {
  const round = n => Math.round(n * 10) / 10;
  const body = scroll.closest('.tile-chart') || scroll.parentElement;
  const box = el => {
    const r = el.getBoundingClientRect();
    return { left:r.left, top:r.top, right:r.left+el.clientLeft+el.clientWidth, bottom:r.top+el.clientTop+el.clientHeight };
  };
  const viewport = box(scroll), bodyBox = box(body);
  const hint = scroll.parentElement.querySelector('.db-data-table-hint');
  const headers=[...scroll.querySelectorAll('thead th')];
  const status=headers.find(el=>el.textContent.toLowerCase()==='status');
  const statusIndex=headers.indexOf(status);
  const problems = [];
  const cells = [...scroll.querySelectorAll('th, td')];
  const minFont = Math.min(...cells.map(el => parseFloat(getComputedStyle(el).fontSize)), ...(hint ? [parseFloat(getComputedStyle(hint).fontSize)] : []));
  const clipped = [...scroll.querySelectorAll('thead th')].filter(el => el.getBoundingClientRect().right > viewport.right+1).map(el=>el.textContent);
  const statusVisible = !status || [...scroll.querySelectorAll('tr')].map(row=>row.children[statusIndex]).filter(Boolean).every(el => {
    const r=el.getBoundingClientRect(); return r.left>=viewport.left-1 && r.right<=viewport.right+1;
  });
  // Scroll every column into the usable viewport. Use actual cell widths,
  // not only header label widths.
  for (const cell of scroll.querySelectorAll('thead th')) {
    scroll.scrollLeft += cell.getBoundingClientRect().left - viewport.left;
    const r=cell.getBoundingClientRect();
    const availableRight=viewport.right;
    if(r.left<viewport.left-1 || r.right>availableRight+1) problems.push(`unreachable column: ${cell.textContent}`);
  }
  scroll.scrollTop=scroll.scrollHeight;
  const last=scroll.querySelector('tbody tr:last-child');
  const lastRowVisible=!last || last.getBoundingClientRect().bottom<=viewport.bottom+1;
  const truncated=cells.filter(el=>el.scrollWidth>el.clientWidth+1 || getComputedStyle(el).textOverflow==='ellipsis').map(el=>el.textContent);
  const r=scroll.getBoundingClientRect(), h=hint?.getBoundingClientRect();
  const regionInside=r.left>=bodyBox.left-1 && r.right<=bodyBox.right+1 && r.top>=bodyBox.top-1 && r.bottom<=bodyBox.bottom+1;
  const hintVisible=!!h && h.height>0 && h.left>=bodyBox.left-1 && h.right<=bodyBox.right+1 && h.top>=bodyBox.top-1 && h.bottom<=bodyBox.bottom+1;
  const result={ outerX:body.scrollWidth-body.clientWidth, outerY:body.scrollHeight-body.clientHeight,
    scrollX:scroll.scrollWidth-scroll.clientWidth, scrollY:scroll.scrollHeight-scroll.clientHeight,
    viewportWidth:round(scroll.clientWidth),viewportHeight:round(scroll.clientHeight),clippedAtStart:clipped,
    problems,truncated,minFont,statusVisible,lastRowVisible,regionInside,hintVisible,keyboardFocusable:scroll.tabIndex===0 };
  scroll.scrollLeft=0;scroll.scrollTop=0;
  return result;
}
