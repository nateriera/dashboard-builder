import { test, expect } from '@playwright/test';

test('both SQL execution paths reject wrapper escapes and preserve quoted content', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('build');
  const result = await page.evaluate(async () => {
    const { runQuery, runQueryDetailed } = await import('/src/data/duckdb.js');
    const results = [];
    for (const run of [runQuery, runQueryDetailed]) {
      let error;
      try { await run('SELECT 1) AS escaped; DROP TABLE categorical; SELECT 1 --'); }
      catch (err) { error = err.message; }
      const valid = await run("/* ; ' */ SELECT label, value, '-- ; ()' AS literal FROM categorical -- inert\n; /* tail */");
      const escaped = await run("SELECT E'it\\'s; (safe)' AS label");
      results.push({ error, rows: valid.rows.length, literal: valid.rows[0].literal, escaped: escaped.rows[0].label });
    }
    return results;
  });
  expect(result).toEqual(Array(2).fill({ error: 'Queries must be a single statement.', rows: 8, literal: '-- ; ()', escaped: "it's; (safe)" }));
});
