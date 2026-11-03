import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themeById } from '../src/themes/themes.js';

test('Paper roots agree on canonical tokens', () => {
  const expected = {
    '--paper':'#F5F1EA', '--white':'#FFFFFF', '--ink':'#1E2347',
    '--periwinkle':'#B7BFD9', '--dusk':'#4A5278', '--slate':'#E7E3D9',
    '--slate-200':'#E7E3D9', '--slate-300':'#9AA0AE', '--slate-400':'#9AA0AE',
    '--slate-500':'#6E7484', '--slate-600':'#3A4054', '--slate-700':'#3A4054',
    '--success':'#2F7D5B', '--warning':'#B97F26', '--danger':'#C0452F',
    '--shadow-card':'0 1px 3px rgba(30,35,71,.08)',
    '--shadow-overlay':'0 8px 24px rgba(30,35,71,.10)',
    '--shadow-focus':'0 0 0 3px rgba(183,191,217,.45)'
  };
  for (const source of ['src/style.css', 'src/export/style.css']) {
    const block = readFileSync(source, 'utf8').match(/:root\s*\{([^}]*)\}/)[1];
    for (const [name, value] of Object.entries(expected)) {
      const actual = block.match(new RegExp(name + ':\\s*([^;]+);'))?.[1].trim();
      assert.equal(actual?.toLowerCase(), value.toLowerCase(), source + ' ' + name);
    }
  }
  for (const [name, value] of Object.entries(expected))
    assert.equal(themeById('paper').css[name]?.toLowerCase(), value.toLowerCase(), 'theme ' + name);
});
