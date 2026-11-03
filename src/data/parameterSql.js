import { validateParameters } from './parameters.js';
import { scanSql } from './sqlLexer.js';

/** Return SQL parameter names that occur in executable SQL, not strings or comments. */
export function referencedParameterNames(sql) {
  const names = new Set();
  for (const { context, text } of scanSql(sql)) {
    if (context !== 'code') continue;
    for (const match of text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) names.add(match[1]);
  }
  return [...names];
}

/** Substitute only original code tokens; inserted literals are never rescanned. */
export function substituteParameters(sql, parameters = []) {
  const byName = new Map(validateParameters(parameters).map(parameter => [parameter.name, parameter]));
  const parts = [];
  for (const { context, start, text } of scanSql(sql)) {
    parts.push(text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (placeholder, name, offset) => {
      if (context !== 'code') throw new Error(`Parameter ${placeholder} is inside ${context}. Write it unquoted: ${name} = ${placeholder}.`);
      const before = sql[start + offset - 1] || '';
      const after = sql[start + offset + placeholder.length] || '';
      if (/[A-Za-z0-9_$.]/.test(before) || /[A-Za-z0-9_$.]/.test(after)) throw new Error(`Parameter ${placeholder} is adjacent to an identifier or dot. Separate it from other SQL tokens.`);
      const parameter = byName.get(name);
      if (!parameter) throw new Error(`Unknown SQL parameter "${name}". Add it in Filters → Parameters.`);
      if (parameter.type === 'date-range' || parameter.type === 'number-range') throw new Error(`Range parameter "${name}" substitutes through bindings, not SQL placeholders.`);
      if (parameter.type === 'boolean') return parameter.value ? 'TRUE' : 'FALSE';
      if (parameter.type === 'number') return String(parameter.value);
      if (parameter.type === 'multi-select') return parameter.value.length ? `(${parameter.value.map(value => `'${value.replace(/'/g, "''")}'`).join(', ')})` : '(NULL)';
      return `'${parameter.value.replace(/'/g, "''")}'`;
    }));
  }
  const expanded = parts.join('');
  if (new TextEncoder().encode(expanded).length > 1024 * 1024) throw new Error('Expanded SQL exceeds the 1 MiB limit.');
  return expanded;
}
