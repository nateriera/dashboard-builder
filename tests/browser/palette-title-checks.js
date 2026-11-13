// Compare rendered title text width with the editor's available content width.
// For wrapping editors, measure each rendered line in an identically styled
// mirror and also check native horizontal/vertical overflow. The unwrapped
// width is retained so hiding an input cannot produce a vacuous zero count.
export function paletteTitleProbe() {
  const titles=[...document.querySelectorAll('.tile-title:not([hidden])')].map(el=>{
    const s=getComputedStyle(el), available=el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);
    const mirror=document.createElement('div');
    mirror.style.cssText='position:fixed;visibility:hidden;border:0;padding:0;margin:0;white-space:pre';
    mirror.style.font=s.font;mirror.style.letterSpacing=s.letterSpacing;mirror.textContent=el.value;
    document.body.append(mirror);
    // Fixed positioned block width otherwise fills the viewport.
    mirror.style.width='max-content';
    const textWidth=mirror.getBoundingClientRect().width;
    const wraps=el.tagName==='TEXTAREA';
    let widths=[textWidth];
    if(wraps){
      mirror.style.width=`${available}px`;mirror.style.whiteSpace='pre-wrap';mirror.style.overflowWrap='anywhere';
      const lines=new Map(),node=mirror.firstChild;let offset=0;
      for(const character of el.value){
        const range=document.createRange();range.setStart(node,offset);offset+=character.length;range.setEnd(node,offset);
        if(!character.trim())continue;
        for(const r of range.getClientRects()){
          const key=Math.round(r.top*4)/4,prior=lines.get(key)||{left:r.left,right:r.right};
          lines.set(key,{left:Math.min(prior.left,r.left),right:Math.max(prior.right,r.right)});
        }
      }
      widths=[...lines.values()].map(r=>r.right-r.left);
    }
    mirror.remove();
    const widestLine=Math.max(0,...widths);
    return {title:el.value,available,textWidth,widestLine,lines:widths.length,fontSize:parseFloat(s.fontSize),
      truncated:widestLine>available+1 || el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1};
  });
  const kpis=[...document.querySelectorAll('.tile')].filter(t=>t.querySelector('.db-kpi')).map(tile=>{
    const body=tile.querySelector('.tile-chart'),r=body.getBoundingClientRect(),problems=[];
    for(const el of body.querySelectorAll('.db-kpi, .db-kpi *, details.chart-data>summary')){
      const b=el.getBoundingClientRect();
      if(b.left<r.left-1||b.right>r.right+1||b.top<r.top-1||b.bottom>r.bottom+1)problems.push(el.className||el.tagName);
    }
    if(body.scrollWidth>body.clientWidth+1||body.scrollHeight>body.clientHeight+1)problems.push('inner scroll');
    return {problems};
  });
  return {titles,kpis,canvasWidth:document.querySelector('.grid-stack').getBoundingClientRect().width};
}
