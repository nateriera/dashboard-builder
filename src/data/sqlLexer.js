const identifierChar = char => /[A-Za-z0-9_$]/.test(char || '');

/** Scan the original SQL into code and opaque quoted/comment spans. */
export function* scanSql(sql) {
  if (typeof sql !== 'string') throw new Error('SQL must be text.');
  let codeStart = 0;
  let i = 0;
  while (i < sql.length) {
    const start = i;
    let context;
    let delimiter;
    if (sql.startsWith('--', i)) context = 'line comment';
    else if (sql.startsWith('/*', i)) context = 'block comment';
    else if (sql[i] === "'") context = 'string';
    else if (sql[i] === '"') context = 'quoted identifier';
    else if (sql[i] === '$' && !identifierChar(sql[i - 1])) {
      delimiter = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i))?.[0];
      if (delimiter) context = 'dollar-quoted string';
    }
    if (!context) { i++; continue; }
    if (codeStart < start) yield { context: 'code', start: codeStart, text: sql.slice(codeStart, start) };
    if (context === 'line comment') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
    } else if (context === 'block comment' || delimiter) {
      const closing = delimiter || '*/';
      const end = sql.indexOf(closing, i + (delimiter?.length || 2));
      if (end < 0) throw new Error(`Unterminated ${context} in query.`);
      i = end + closing.length;
    } else {
      const quote = sql[i++];
      const escapes = quote === "'" && /[Ee]/.test(sql[start - 1] || '') && !identifierChar(sql[start - 2]);
      let closed = false;
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) throw new Error(`Unterminated ${context} in query.`);
    }
    yield { context, start, text: sql.slice(start, i) };
    codeStart = i;
  }
  if (codeStart < i) yield { context: 'code', start: codeStart, text: sql.slice(codeStart, i) };
}
