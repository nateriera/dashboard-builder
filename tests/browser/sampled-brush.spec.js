import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickHeaderAction } from './header-actions.js';

const rowCount = 3001;
const firstDay = Date.UTC(2020, 0, 1);
const sourceRows = Array.from({ length: rowCount }, (_, index) => ({
  record_id: `record-${String(index).padStart(4, '0')}`,
  // This source column deliberately collides with the normalized date key.
  date: `Original date ${index}`,
  observed: new Date(firstDay + index * 86400000).toISOString().slice(0, 10),
  amount: index > 0 && index < rowCount - 1 && index % 97 === 0 ? '' : String(index + 1),
  segment: index % 2 ? 'West' : 'East'
}));

function fixture(type) {
  const rows = sourceRows.map(row => ({
    date: row.observed,
    value: row.amount === '' ? null : Number(row.amount),
    series: row.segment
  }));
  const columns = Object.keys(sourceRows[0]);
  const tile = (id, y) => ({
    id, type, title: id, source: 'Sampled source records', dataset: 'upload:sampled',
    binding: { mode: 'explicit', ref: 'upload:sampled' },
    sizing: 'manual', tileOptions: {}, x: 0, y, w: 12, h: 18
  });
  return {
    app: 'dashboard-builder', version: 3, rowHeight: 24, theme: 'paper',
    tiles: [tile('brush-source', 0), tile('brush-target', 19)],
    datasets: {
      sampled: {
        name: 'Sampled source records', columns, rows,
        fieldKeys: ['date', 'value', 'series'],
        mapping: { date: 'observed', value: 'amount', series: 'segment' },
        raw: { columns, rows: sourceRows }
      }
    }
  };
}

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const hint = page.locator('.first-run-hint');
  if (await hint.isVisible()) await hint.getByRole('button', { name: 'Got it' }).click();
}

async function brushVisibleRecords(page, sourceTile) {
  const svg = sourceTile.locator('.tile-chart svg[role="img"][viewBox]');
  await expect(svg).toBeVisible();
  const geometry = await svg.evaluate((svg, dates) => {
    const points = [...svg.querySelectorAll('g[aria-label="dot"] circle')]
      .map(circle => ({ x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((a, b) => a.x - b.x);
    // The endpoints are present and uniquely dated. Infer each actual mark's
    // source position from its coordinate, never from a source-array index or
    // the implementation's sampling formula. Missing numeric cells have no dot.
    const firstX = points[0].x, lastX = points.at(-1).x;
    const left = (points[799].x + points[800].x) / 2;
    const right = (points[879].x + points[880].x) / 2;
    const selected = points.filter(point => point.x >= left && point.x <= right);
    // Match the chart's local-midnight date promotion. Calendar days spanning
    // DST do not all have the same duration, so a fractional day index would
    // incorrectly identify otherwise accurate rendered coordinates.
    const times = dates.map(date => new Date(`${date}T00:00:00`).getTime());
    const selectedTimes = selected.map(point => times[0] + (point.x - firstX) / (lastX - firstX) * (times.at(-1) - times[0]));
    const positions = selectedTimes.map(time => times.reduce((nearest, candidate, index) =>
      Math.abs(candidate - time) < Math.abs(times[nearest] - time) ? index : nearest, 0));
    const timeErrors = positions.map((index, selectedIndex) => Math.abs(times[index] - selectedTimes[selectedIndex]));
    const bounds = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
    return {
      markCount: points.length,
      positions,
      timeErrors,
      left: bounds.left + (left - view.x) / view.width * bounds.width,
      right: bounds.left + (right - view.x) / view.width * bounds.width,
      y: bounds.top + bounds.height * 0.45
    };
  }, sourceRows.map(row => row.observed));
  expect(geometry.markCount).toBeGreaterThan(1900);
  expect(geometry.markCount).toBeLessThan(2000);
  expect(geometry.positions).toHaveLength(80);
  expect(geometry.right - geometry.left).toBeGreaterThan(12);
  for (const error of geometry.timeErrors) expect(error).toBeLessThan(1000);
  const expected = geometry.positions.map(position => sourceRows[position]);
  expect(new Set(expected.map(row => row.record_id)).size).toBe(80);
  expect(expected.every(row => row.amount !== '')).toBe(true);

  await page.mouse.move(geometry.left, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.right, geometry.y, { steps: 6 });
  await expect(sourceTile.locator('.db-time-brush')).toHaveCount(1);
  await page.mouse.up();
  return expected;
}

async function expectOriginalRecords(targetTile, expected) {
  const details = targetTile.locator('.chart-data:not(.chart-drillthrough)');
  await expect(details.locator('summary')).toContainText(`(${expected.length} rows)`);
  await details.locator('summary').click();
  await expect(details.locator('tbody tr')).toHaveCount(expected.length);
  const actual = await details.evaluate(details => {
    const keys = [...details.querySelectorAll('thead button')].map(button => button.getAttribute('aria-label').slice('Sort by '.length));
    return [...details.querySelectorAll('tbody tr')].map(row => Object.fromEntries(
      [...row.querySelectorAll('td')].map((cell, index) => [keys[index], cell.textContent])
    ));
  });
  // Compare complete unmerged records, including the colliding original date
  // and original numeric strings, rather than just normalized dates/counts.
  expect(actual).toEqual(expected);
}

for (const type of ['line', 'area']) {
  test(`S9: sampled ${type} brushing selects exactly the visible source marks in composer and offline HTML`, async ({ page, browser }) => {
    test.setTimeout(90000);
    await ready(page);
    await page.locator('#file-import').setInputFiles({
      name: 'sampled-brush.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture(type)))
    });
    await expect(page.locator('#status')).toContainText('Imported');
    const source = page.locator('.grid-stack-item[gs-id="brush-source"]');
    const target = page.locator('.grid-stack-item[gs-id="brush-target"]');
    await expect(source.locator('.chart-transform-note')).toContainText('2,000 evenly spaced rows of 3,001');
    await expect(target.locator('.chart-data summary')).toContainText('(3,001 rows)');

    // Export before brushing so each surface starts from the same full rows.
    const downloading = page.waitForEvent('download');
    await clickHeaderAction(page, '#btn-export-html');
    const html = await fs.readFile(await (await downloading).path(), 'utf8');
    const selected = await brushVisibleRecords(page, source);
    await expectOriginalRecords(target, selected);
    await clickHeaderAction(page, '#btn-save');
    await page.reload(); await expect(page.locator('#status')).toContainText('build');
    await expectOriginalRecords(target, selected);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await context.setOffline(true);
      const offline = await context.newPage();
      await offline.route('**/*', route => route.abort());
      await offline.setContent(html, { waitUntil: 'load' });
      const offlineSource = offline.locator('.export-tile').first();
      const offlineTarget = offline.locator('.export-tile').last();
      await expect(offlineTarget.locator('.chart-data summary')).toContainText('(3,001 rows)');
      const offlineSelected = await brushVisibleRecords(offline, offlineSource);
      expect(offlineSelected).toEqual(selected);
      await expectOriginalRecords(offlineTarget, offlineSelected);
    } finally { await context.close(); }
  });
}
