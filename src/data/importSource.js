import { LIMITS } from './limits.js';


const MAX_BYTES = LIMITS.fileBytes;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.localhost|.*\.internal)$/i;

export function parsePastedTable(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Pasted data is empty. Copy a table with headers and rows, then paste it here.');
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Paste limit is 16 MiB. Split or aggregate the data.');
  const delimiter = text.includes('\t') ? '\t' : ',';
  const parsed = delimiter === '\t' ? parseDelimited(text, '\t') : parseCsv(text);
  const columns = parsed[0].map((name) => name.trim());
  if (!columns.length || columns.every((name) => !name)) throw new Error('No headers found in pasted data.');
  if (columns.length > LIMITS.columns) throw new Error(`Column limit is ${LIMITS.columns}.`);
  if (parsed.length < 2) throw new Error('Pasted data has headers but no data rows.');
  const rows = parsed.slice(1).map((values, index) => {
    if (values.length !== columns.length) throw new Error(`Row ${index + 2} has ${values.length} cells; expected ${columns.length}. All rows must have the same number of columns.`);
    const result = {};
    columns.forEach((column, i) => {
      if (!column || ['__proto__', 'constructor', 'prototype'].includes(column)) throw new Error('Header names must be non-empty and cannot be reserved words.');
      if (Object.hasOwn(result, column)) throw new Error(`Duplicate column name: ${column}.`);
      result[column] = values[i] ?? '';
    });
    return result;
  });
  if (rows.length > LIMITS.rows) throw new Error(`Row limit is ${LIMITS.rows.toLocaleString()}. Reduce the pasted data.`);
  return { columns, rows };
}

function parseCsv(text) {
  try { return parseDelimited(text, ','); }
  catch { throw new Error('That pasted table could not be parsed as CSV.'); }
}

function parseDelimited(text, delimiter) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const rows = [];
  let expectedCells = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const cells = [];
    let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { cells.push(value); value = ''; }
      else value += char;
    }
    if (quoted) throw new Error(`Row ${lineIndex + 1} has an unclosed quoted cell.`);
    cells.push(value);
    if (expectedCells == null) expectedCells = cells.length;
    else if (cells.length !== expectedCells) throw new Error(`Row ${lineIndex + 1} has ${cells.length} cells; expected ${expectedCells}. All rows must have the same number of columns.`);
    rows.push(cells);
  }
  return rows;
}

export function prepareCsvUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid public URL to a CSV file.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP or HTTPS CSV URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.');
  if (isPrivateHost(url.hostname)) throw new Error('Private or local network URLs are not supported. Use a public CSV URL.');
  if (url.hostname.toLowerCase() === 'docs.google.com') {
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (!match) throw new Error('Use a public Google Sheets spreadsheet link. Private Sheets and other Google links are not supported.');
    const gid = url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1];
    url.pathname = `/spreadsheets/d/${match[1]}/export`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('format', 'csv');
    if (gid && /^\d+$/.test(gid)) url.searchParams.set('gid', gid);
  } else if (!/\.csv$/i.test(url.pathname) && !url.searchParams.has('output')) {
    throw new Error('URL must point to a .csv file or a public Google Sheets spreadsheet.');
  }
  return url;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host) || host === '::1' || host === '::' || host === '0.0.0.0') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    return octets.some((part) => part > 255) || octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  }
  return false;
}

export async function fetchCsvText(input, { fetchImpl = fetch, signal } = {}) {
  const url = prepareCsvUrl(input);
  let response;
  try { response = await fetchImpl(url, { mode: 'cors', credentials: 'omit', redirect: 'error', signal }); }
  catch { throw new Error('Could not fetch this public CSV. Check the URL and CORS access, then try again.'); }
  if (!response.ok) throw new Error(`CSV request failed (HTTP ${response.status}). Check that the file is public and the URL is correct.`);
  const type = response.headers.get('content-type') || '';
  if (/text\/html|application\/json/i.test(type)) throw new Error('The URL did not return a CSV response; it returned a web page or JSON. Use a direct public CSV link or a public Sheets CSV export link.');
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_BYTES) throw new Error('Download limit is 16 MiB. Reduce the CSV before importing.');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Download limit is 16 MiB. Reduce the CSV before importing.');
  if (!text.trim()) throw new Error('The CSV response is empty.');
  if (/^\s*</.test(text)) throw new Error('The URL returned a web page, not CSV. Check public sharing or use a direct CSV link.');
  return text;
}
