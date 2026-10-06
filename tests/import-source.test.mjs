import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedTable, prepareCsvUrl } from '../src/data/importSource.js';

test('paste parses spreadsheet TSV with headers and quoted tabs', () => {
  assert.deepEqual(parsePastedTable('City\tPopulation\r\n"New\tTown"\t42\r\n'), {
    columns: ['City', 'Population'],
    rows: [{ City: 'New\tTown', Population: '42' }]
  });
});

test('paste rejects empty, header-only, and irregular tabular content', () => {
  assert.throws(() => parsePastedTable(' \r\n'), /empty/i);
  assert.throws(() => parsePastedTable('City\tValue'), /data rows/i);
  assert.throws(() => parsePastedTable('City\tValue\na\t1\nb'), /same number of columns/i);
});

test('paste enforces existing byte, row, and column limits', () => {
  assert.throws(() => parsePastedTable('x\n' + 'a'.repeat(16 * 1024 * 1024)), /16 MiB/i);
  assert.throws(() => parsePastedTable(Array.from({ length: 102 }, (_, i) => `c${i}`).join('\t') + '\n' + Array(102).fill('v').join('\t')), /column limit/i);
});

test('URL validation permits public HTTP CSV links and converts public Sheets edit links', () => {
  assert.equal(prepareCsvUrl('https://example.com/data.csv').href, 'https://example.com/data.csv');
  const sheet = prepareCsvUrl('https://docs.google.com/spreadsheets/d/abc123/edit?gid=7#gid=7');
  assert.equal(sheet.hostname, 'docs.google.com');
  assert.equal(sheet.pathname, '/spreadsheets/d/abc123/export');
  assert.equal(sheet.searchParams.get('format'), 'csv');
  assert.equal(sheet.searchParams.get('gid'), '7');
});

test('URL validation rejects credentials, non-HTTP schemes, and local/private hosts', () => {
  for (const url of ['file:///tmp/data.csv', 'ftp://example.com/data.csv', 'https://user:pass@example.com/data.csv', 'http://localhost/data.csv', 'http://127.0.0.1/data.csv', 'https://private.local/data.csv']) {
    assert.throws(() => prepareCsvUrl(url));
  }
});

test('URL fetch reports HTTP and unsupported response errors and enforces download size', async () => {
  const { fetchCsvText } = await import('../src/data/importSource.js');
  const fail = async () => new Response('nope', { status: 404 });
  await assert.rejects(fetchCsvText('https://example.com/data.csv', { fetchImpl: fail }), /HTTP 404/i);
  const html = async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchCsvText('https://example.com/data.csv', { fetchImpl: html }), /CSV response/i);
  const big = async () => new Response('x'.repeat(16 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/csv' } });
  await assert.rejects(fetchCsvText('https://example.com/data.csv', { fetchImpl: big }), /16 MiB/i);
});
