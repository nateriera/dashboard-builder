import { scanSql } from './sqlLexer.js';

/** Validate the executed copy before it is placed inside the result wrapper. */
export function prepareStatement(sql) {
  const parts = [];
  let semicolons = 0;
  let depth = 0;
  let unbalanced = false;
  for (const { context, text } of scanSql(sql)) {
    parts.push(context.endsWith('comment') ? ' ' : text);
    if (context !== 'code') continue;
    for (const char of text) {
      if (char === ';') semicolons++;
      if (char === '(') depth++;
      if (char === ')' && --depth < 0) unbalanced = true;
    }
  }
  let prepared = parts.join('').trim();
  if (prepared.endsWith(';')) { prepared = prepared.slice(0, -1).trimEnd(); semicolons--; }
  if (semicolons) throw new Error('Queries must be a single statement.');
  if (unbalanced || depth !== 0) throw new Error('Unbalanced parentheses in query.');
  if (!/^(SELECT|WITH)\b/i.test(prepared)) throw new Error('Only SELECT/WITH queries are supported.');
  return prepared;
}
