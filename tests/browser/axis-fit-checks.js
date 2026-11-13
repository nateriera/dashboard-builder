// SVG text boxes are candidate intersections, not proof of painted collisions.
// The >4px gate excludes the census's classified touch class. The baseline
// screenshots and visual classifications are recorded in the S6 report.
export function axisFitProbe(tiles) {
 return tiles.map(tile => {
  const problems = [];
  const charts = [...tile.querySelectorAll('svg')].filter(svg => svg.querySelector('[aria-label*="-axis"]')).map(svg => {
    const box = svg.getBoundingClientRect();
    const plot = typeof svg.scale === 'function' ? svg : svg.closest('figure');
    const texts = [...svg.querySelectorAll('text')].filter(el => el.textContent.trim()).map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, lines: [...el.querySelectorAll('tspan')].map(t => t.textContent),
        group: el.parentElement.getAttribute('aria-label') || '', transform: el.getAttribute('transform'),
        x: r.x-box.x, y: r.y-box.y, width: r.width, height: r.height, font: parseFloat(getComputedStyle(el).fontSize) };
    });
    for (const t of texts.filter(t => /axis (label|tick label)/.test(t.group))) {
      if (t.font < 12) problems.push(`small font: ${t.text}`);
      if (t.x < -1 || t.x+t.width > box.width+1) problems.push(`horizontal clipping: ${t.text}`);
      if (t.y < -4 || t.y+t.height > box.height+4) problems.push(`vertical clipping: ${t.text}`);
    }
    const collisions = [];
    for (let i=0;i<texts.length;i++) for(let j=i+1;j<texts.length;j++) {
      const a=texts[i], b=texts[j];
      const width=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
      const height=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(width>4.1 && height>4.1) collisions.push({a:a.text,b:b.text,width,height});
    }
    for (const c of collisions) problems.push(`text intersection: ${c.a} / ${c.b}`);
    const axes = Object.fromEntries(['x','y','fx','fy'].map(axis => {
      const scale=plot?.scale?.(axis);
      const ticks=texts.filter(t=>t.group===`${axis}-axis tick label`);
      // Continuous domains use selected numeric/time ticks. Ordinal domains
      // must retain every label (including the existing category shortening).
      if(scale && ['point','band','ordinal'].includes(scale.type) && ticks.length) {
        if(ticks.length !== scale.domain.length) problems.push(`${axis}: missing categorical ticks`);
        ticks.forEach((tick,index) => {
          const value=String(scale.domain[index]);
          const shortened=tick.text.endsWith('…') && value.startsWith(tick.text.slice(0,-1));
          if(tick.text !== value && !shortened) problems.push(`${axis}: tick does not match domain member ${value}`);
        });
      }
      return [axis,{type:scale?.type,domain:scale?.domain,labels:ticks.map(t=>t.text),rotations:ticks.map(t=>t.transform)}];
    }));
    return { width:box.width,height:box.height,titles:texts.filter(t=>t.group.endsWith('axis label')),axes,collisions };
  });
  return { title:tile.querySelector('[aria-label="Tile title"]')?.value, charts, problems };
 });
}
