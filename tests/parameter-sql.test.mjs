import { test } from 'node:test';
import assert from 'node:assert/strict';
import { substituteParameters } from '../src/data/parameters.js';
import { referencedParameterNames } from '../src/data/parameterSql.js';

const text = value => [{ name: 'p', type: 'text', value }];

test('SQL parameter inventory includes code tokens once and ignores quoted text and comments', () => {
  assert.deepEqual(referencedParameterNames("SELECT {{growth}}, {{growth}} -- {{note}}\nFROM t WHERE label='{{literal}}' /* {{also_ignored}} */ AND x={{region}}"), ['growth','region']);
});

test('parameters in code become literals, including hostile text and finite numbers', () => {
  const hostile = "x'); DROP TABLE upload_sales; --";
  assert.equal(substituteParameters('SELECT * FROM sales WHERE region = {{p}};', text(hostile)), "SELECT * FROM sales WHERE region = 'x''); DROP TABLE upload_sales; --';");
  for (const value of [0, -1.5, 1e25, 1e-9]) {
    assert.equal(substituteParameters('SELECT {{p}}', [{ name: 'p', type: 'number', value }]), `SELECT ${String(value)}`);
  }
});

test('parameters inside every non-code context name the parameter and unquoted fix', () => {
  for (const sql of ["SELECT '{{p}}'", "SELECT 'it''s {{p}}'", 'SELECT "{{p}}"', 'SELECT "a""{{p}}"', 'SELECT 1 -- {{p}}', 'SELECT /* {{p}} */ 1', 'SELECT $$ {{p}} $$', 'SELECT $tag_1$ {{p}} $tag_1$', "SELECT E'it\\'s {{p}}'"]) {
    assert.throws(() => substituteParameters(sql, text('hostile')), error => error.message.includes('{{p}}') && /inside|context/i.test(error.message) && /unquoted/i.test(error.message), sql);
  }
});

test('parameter token adjacency rejects identifiers, digits, dollars, and dots on either side', () => {
  for (const char of ['a', 'Z', '0', '_', '$', '.']) {
    for (const sql of [`SELECT ${char}{{p}}`, `SELECT {{p}}${char}`]) {
      assert.throws(() => substituteParameters(sql, text('x')), /adjacent/i, sql);
    }
  }
  assert.equal(substituteParameters('SELECT ({{p}}), {{p}}||{{p}}', text('x')), "SELECT ('x'), 'x'||'x'");
});

test('replacement text is never scanned or expanded again', () => {
  assert.equal(substituteParameters('SELECT {{p}}, {{q}}', [...text('{{q}}'), { name: 'q', type: 'text', value: 'expanded' }]), "SELECT '{{q}}', 'expanded'");
  assert.equal(substituteParameters('SELECT {{p}}', text("' /* {{missing}} --")), "SELECT ''' /* {{missing}} --'");
});

test('unknown names and malformed SQL fail closed through the public substitution API', () => {
  assert.throws(() => substituteParameters('SELECT {{missing}}'), /Unknown SQL parameter "missing"/);
  for (const sql of ["SELECT 'oops", 'SELECT "oops', 'SELECT $$oops', 'SELECT $tag$oops', 'SELECT /* oops', "SELECT E'it\\'"]) {
    assert.throws(() => substituteParameters(sql), /Unterminated/);
  }
  assert.throws(() => substituteParameters(null), /SQL must be text/);
  assert.throws(() => substituteParameters('SELECT {{p}}', [{ name: 'p', type: 'number', value: Infinity }]), /Invalid numeric parameter/);
});

test('expanded SQL has a 1 MiB UTF-8 cap, including escaped quotes and multibyte values', () => {
  const cap = 1024 * 1024;
  assert.equal(new TextEncoder().encode(substituteParameters(' '.repeat(cap - 5) + '{{p}}', text('é'))).length, cap - 1);
  assert.throws(() => substituteParameters(' '.repeat(cap - 3) + '{{p}}', text('é')), /1 MiB/);
  assert.throws(() => substituteParameters('SELECT ' + '{{p}}'.repeat(60), text("'".repeat(10000))), /1 MiB/);
  assert.throws(() => substituteParameters(' '.repeat(cap + 1)), /1 MiB/);
  assert.equal(substituteParameters(' '.repeat(cap)).length, cap);
});
