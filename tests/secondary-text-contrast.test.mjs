import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, themeById } from '../src/themes/themes.js';

// Contrast AA guard for the secondary-text layer (UI critique F-A11Y-1).
// Every ratio is computed from the live token definitions — the theme
// registry and the two :root copies (composer + export viewer) — never from
// a copied hex list, so a token edit that drops a pair below AA fails here.

function luminance(color) {
  const hex = color.trim().replace('#', '');
  assert.match(hex, /^[0-9a-f]{6}$/i, `expected a 6-digit hex token, got ${color}`);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_SMALL = 4.5;

// §0 census pairs (base 8581a2c): secondary text below 4.5:1 where it renders.
// [theme, text token, surface token, where it renders]
const SECTION0_PAIRS = [
  ['paper', '--slate-500', '--paper', 'tile "Data source" caption (11px) on the ivory tile data row'],
  ['paper', '--slate-500', '--slate', 'theme-picker blurb (12px) on the current option']
];

function rootTokens(source) {
  const block = readFileSync(source, 'utf8').match(/:root\s*\{([^}]*)\}/)[1];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

const SOURCES = [
  ['src/themes/themes.js', id => themeById(id).css],
  // The :root copies carry Paper's values for first paint (composer) and the
  // exported viewer; they must land on the same values.
  ['src/style.css', id => (id === 'paper' ? rootTokens('src/style.css') : null)],
  ['src/export/style.css', id => (id === 'paper' ? rootTokens('src/export/style.css') : null)]
];

for (const [theme, text, surface, where] of SECTION0_PAIRS) {
  test(`§0 ${theme}: ${text} on ${surface} meets AA (${where})`, () => {
    for (const [source, tokensFor] of SOURCES) {
      const tokens = tokensFor(theme);
      if (!tokens) continue;
      assert.ok(tokens[text] && tokens[surface], `${source} defines ${text} and ${surface}`);
      const ratio = contrast(tokens[text], tokens[surface]);
      assert.ok(ratio >= AA_SMALL, `${source} ${theme} ${text} ${tokens[text]} on ${surface} ${tokens[surface]} = ${ratio.toFixed(2)}:1 < ${AA_SMALL}`);
    }
  });
}

test('every theme: secondary text tokens meet AA on the tile and page surfaces', () => {
  for (const t of THEMES) {
    for (const text of ['--slate-500', '--slate-600']) {
      for (const surface of ['--white', '--paper']) {
        const ratio = contrast(t.css[text], t.css[surface]);
        assert.ok(ratio >= AA_SMALL, `${t.id} ${text} ${t.css[text]} on ${surface} ${t.css[surface]} = ${ratio.toFixed(2)}:1`);
      }
    }
    for (const text of ['muted', 'mutedStrong']) {
      const ratio = contrast(t.chart[text], t.chart.card);
      assert.ok(ratio >= AA_SMALL, `${t.id} chart.${text} ${t.chart[text]} on chart.card ${t.chart.card} = ${ratio.toFixed(2)}:1`);
    }
  }
});

// Dark-theme legibility census at ba2b7d5: read the consuming declarations
// as well as their tokens, so reverting a selector to --ink fails the guard.
function declarations(source, selector) {
  const css = readFileSync(source, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const result = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some(s => s.trim() === selector)) continue;
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > -1) result[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return result;
}

function tokenColor(value, tokens) {
  assert.ok(value, 'expected an explicit color declaration (UA defaults are not token-driven)');
  const variable = value.match(/^var\((--[\w-]+)\)$/);
  if (!variable) return value;
  assert.ok(tokens[variable[1]], `missing token ${variable[1]}`);
  return tokenColor(tokens[variable[1]], tokens);
}

const ACCENT_SURFACES = [
  ['src/style.css', '#btn-export-html', 'Share as HTML'],
  ['src/export/style.css', '.export-badge', 'Offline snapshot']
];
const PLACEHOLDER_SURFACES = [
  ['.tpl-name-input', '.tpl-name-input', 'Template name'],
  ['.parameter-step', '.dashboard-parameter input', 'Any (numeric parameter step)'],
  ['.data-sql-input', '.data-sql-input', 'Calculated field formula']
];

for (const theme of THEMES) {
  for (const [source, selector, label] of ACCENT_SURFACES) {
    test(`accent text ${theme.id}: ${label} meets AA`, () => {
      const style = declarations(source, selector);
      for (const tokens of [theme.css, ...(theme.id === 'paper' ? [rootTokens(source)] : [])]) {
        const ratio = contrast(tokenColor(style.color, tokens), tokenColor(style.background, tokens));
        assert.ok(ratio >= AA_SMALL, `${source} ${selector} ${theme.id}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
  for (const [selector, backgroundSelector, label] of PLACEHOLDER_SURFACES) {
    test(`placeholder ${theme.id}: ${label} meets AA`, () => {
      const placeholder = declarations('src/style.css', `${selector}::placeholder`);
      const input = declarations('src/style.css', backgroundSelector);
      // Explicit opacity also avoids browser-specific placeholder fading.
      assert.equal(placeholder.opacity, '1', `${selector}::placeholder must have explicit opacity`);
      for (const tokens of [theme.css, ...(theme.id === 'paper' ? [rootTokens('src/style.css')] : [])]) {
        const ratio = contrast(tokenColor(placeholder.color, tokens), tokenColor(input.background, tokens));
        assert.ok(ratio >= AA_SMALL, `${selector} ${theme.id}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
}
