// Paginated text alternative uses authoritative rows, including sampled plots.
export function chartData(rows, fields, title, { summaryLabel } = {}) {
  const details = document.createElement('details');
  details.className = 'chart-data';
  const summary = document.createElement('summary');
  summary.textContent = summaryLabel || `View data for ${title || 'chart'} (${rows.length.toLocaleString()} rows)`;
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = title || 'Chart data';
  const tools=document.createElement('div');tools.className='chart-data-tools';
  const search=document.createElement('input');search.type='search';search.placeholder='Search records';search.setAttribute('aria-label',`Search records in ${title||'chart'}`);
  const pageSize=document.createElement('select');pageSize.setAttribute('aria-label','Rows per page');
  for(const size of [25,50,100]){const option=document.createElement('option');option.value=String(size);option.textContent=`${size} rows`;pageSize.append(option);}
  pageSize.value='100';tools.append(search,pageSize);
  const nav = document.createElement('div');
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button'; previous.textContent = 'Previous rows'; next.textContent = 'Next rows';
  const status = document.createElement('span'); status.setAttribute('aria-live','polite');
  nav.append(previous,status,next); details.append(summary,tools,nav,table);
  let page = 0,sortKey=null,sortDirection=1;
  function paint() {
    table.replaceChildren(caption);
    const head = document.createElement('thead'), tr = document.createElement('tr');
    for (const f of fields) { const th = document.createElement('th'); th.scope = 'col';const button=document.createElement('button');button.type='button';button.textContent=`${f.key}${sortKey===f.key?(sortDirection===1?' ↑':' ↓'):''}`;button.setAttribute('aria-label',`Sort by ${f.key}`);button.addEventListener('click',()=>{if(sortKey===f.key)sortDirection*=-1;else{sortKey=f.key;sortDirection=1;}page=0;paint();});th.append(button);tr.append(th); }
    head.append(tr); table.append(head);
    const body = document.createElement('tbody');
    const query=search.value.trim().toLocaleLowerCase();let visible=rows.filter(row=>!query||fields.some(field=>String(row[field.key]??'').toLocaleLowerCase().includes(query)));
    if(sortKey){visible=visible.slice().sort((a,b)=>{const av=a[sortKey],bv=b[sortKey];if(av==null)return bv==null?0:-sortDirection;if(bv==null)return sortDirection;return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}))*sortDirection;});}
    const size=Number(pageSize.value),pages=Math.ceil(visible.length/size);page=Math.min(page,Math.max(0,pages-1));
    for (const r of visible.slice(page * size, (page + 1) * size)) {
      const tr = document.createElement('tr');
      for (const f of fields) { const td = document.createElement('td'); td.textContent = r[f.key] == null ? '—' : String(r[f.key]); tr.append(td); }
      body.append(tr);
    }
    if(!visible.length){const tr=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=Math.max(1,fields.length);cell.textContent=query?'No records match your search.':'No records to display.';tr.append(cell);body.append(tr);}
    table.append(body);
    previous.disabled = page === 0; next.disabled = (page + 1) * size >= visible.length;
    status.textContent = `Rows ${visible.length ? page * size + 1 : 0}–${Math.min(visible.length,(page + 1) * size)} of ${visible.length} `;
  }
  previous.onclick = () => { page--; paint(); }; next.onclick = () => { page++; paint(); };
  search.addEventListener('input',()=>{page=0;paint();});pageSize.addEventListener('change',()=>{page=0;paint();});
  // Build cells only when opened, so large fixtures never create a huge DOM.
  details.addEventListener('toggle', () => { if (details.open) paint(); });
  return details;
}
