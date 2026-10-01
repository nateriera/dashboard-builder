// Paginated text alternative uses authoritative rows, including sampled plots.
export function chartData(rows, fields, title) {
  const details = document.createElement('details');
  details.className = 'chart-data';
  const summary = document.createElement('summary');
  summary.textContent = `View data for ${title || 'chart'} (${rows.length.toLocaleString()} rows)`;
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = title || 'Chart data';
  const nav = document.createElement('div');
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button'; previous.textContent = 'Previous rows'; next.textContent = 'Next rows';
  const status = document.createElement('span'); status.setAttribute('aria-live','polite');
  nav.append(previous,status,next); details.append(summary,nav,table);
  let page = 0;
  function paint() {
    table.replaceChildren(caption);
    const head = document.createElement('thead'), tr = document.createElement('tr');
    for (const f of fields) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = f.key; tr.append(th); }
    head.append(tr); table.append(head);
    const body = document.createElement('tbody');
    for (const r of rows.slice(page * 100, (page + 1) * 100)) {
      const tr = document.createElement('tr');
      for (const f of fields) { const td = document.createElement('td'); td.textContent = r[f.key] == null ? '—' : String(r[f.key]); tr.append(td); }
      body.append(tr);
    }
    table.append(body);
    previous.disabled = page === 0; next.disabled = (page + 1) * 100 >= rows.length;
    status.textContent = `Rows ${rows.length ? page * 100 + 1 : 0}–${Math.min(rows.length,(page + 1) * 100)} of ${rows.length} `;
  }
  previous.onclick = () => { page--; paint(); }; next.onclick = () => { page++; paint(); };
  // Build cells only when opened, so large fixtures never create a huge DOM.
  details.addEventListener('toggle', () => { if (details.open) paint(); });
  return details;
}
