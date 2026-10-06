const IDENTIFIER = (value) => `"${String(value).replaceAll('"', '""')}"`;
const AGGREGATIONS = new Set(['COUNT', 'COUNT DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']);

export function quoteIdentifier(value) {
  return IDENTIFIER(value);
}

export function dateBinExpression(column, bin) {
  const value = `TRY_CAST(${IDENTIFIER(column)} AS TIMESTAMP)`;
  if (bin === 'month') return `strftime(date_trunc('month', ${value}), '%Y-%m')`;
  if (bin === 'quarter') return `(strftime(date_trunc('quarter', ${value}), '%Y') || '-Q' || CAST(quarter(${value}) AS VARCHAR))`;
  if (bin === 'year') return `strftime(date_trunc('year', ${value}), '%Y')`;
  throw new Error('Date grouping must be month, quarter, or year.');
}

export function aggregationOptions(typeName) {
  const type = String(typeName || '').toUpperCase();
  const common = ['COUNT', 'COUNT DISTINCT', 'MIN', 'MAX'];
  const numericType = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|DECIMAL|REAL)/i;
  const arrowNumericType = /^(INT|UINT|FLOAT|DOUBLE|HALF)/i;
  return numericType.test(type) || arrowNumericType.test(type)
    ? ['COUNT', 'COUNT DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']
    : common;
}

export function buildPivotSql({ table, sourceSql, groups = [], aggregations = [], types = {} }) {
  if (!Array.isArray(groups) || !Array.isArray(aggregations) || (!groups.length && !aggregations.length)) {
    throw new Error('Add at least one grouping or aggregation.');
  }
  const groupExpressions = groups.map((group) => {
    if (!group?.column) throw new Error('Choose a column for every grouping.');
    const expression = group.bin ? dateBinExpression(group.column, group.bin) : IDENTIFIER(group.column);
    const label = group.bin ? `${group.column} (${group.bin})` : group.column;
    return { expression, label };
  });
  const aggregateExpressions = aggregations.map((aggregate) => {
    const operation = String(aggregate?.operation || '').toUpperCase();
    if (!AGGREGATIONS.has(operation)) throw new Error(`Unsupported aggregation: ${operation || '(empty)'}.`);
    if (!aggregate.column) throw new Error('Choose a source column for every aggregation.');
    const type = types[aggregate.column];
    if (['SUM', 'AVG'].includes(operation) && type && !aggregationOptions(type).includes(operation)) {
      throw new Error(`${operation} requires a numeric column.`);
    }
    const output = String(aggregate.name || `${operation} ${aggregate.column}`).trim();
    if (!output) throw new Error('Every aggregation needs an output name.');
    const field = IDENTIFIER(aggregate.column);
    const expression = operation === 'COUNT DISTINCT'
      ? `COUNT(DISTINCT ${field})`
      : `${operation}(${field})`;
    return { expression, name: output };
  });
  const labels = [...groupExpressions.map((item) => item.label), ...aggregateExpressions.map((item) => item.name)];
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
    throw new Error('Grouping and aggregation output names must be unique.');
  }
  const selections = [
    ...groupExpressions.map(({ expression, label }) => `${expression} AS ${IDENTIFIER(label)}`),
    ...aggregateExpressions.map(({ expression, name }) => `${expression} AS ${IDENTIFIER(name)}`)
  ];
  const from = sourceSql ? `(${sourceSql}) AS wrangle_source` : IDENTIFIER(table);
  return `SELECT ${selections.join(', ')} FROM ${from}` +
    (groupExpressions.length ? ` GROUP BY ${groupExpressions.map(({ expression }) => expression).join(', ')}` : '');
}

export function buildCalculatedFieldSql({ table, sourceSql, formula, name, columns = [] }) {
  const expression = String(formula || '').trim();
  if (!expression || /;|--|\/\*/.test(expression)) {
    throw new Error('Enter a formula as one valid DuckDB expression (without a semicolon or SQL comment).');
  }
  const output = String(name || '').trim();
  if (!output) throw new Error('Enter a name for the calculated field.');
  if (output.length > 128) throw new Error('Calculated field names must be 128 characters or fewer.');
  if (columns.some((column) => String(column).toLowerCase() === output.toLowerCase())) {
    throw new Error(`A column named "${output}" already exists.`);
  }
  const from = sourceSql ? `(${sourceSql}) AS wrangle_source` : IDENTIFIER(table);
  return `SELECT *, (${expression}) AS ${IDENTIFIER(output)} FROM ${from} LIMIT 5`;
}

export function buildCalculatedFieldApplySql({ table, sourceSql, formula, name }) {
  const output = String(name || '').trim();
  const from = sourceSql ? `(${sourceSql}) AS wrangle_source` : IDENTIFIER(table);
  return `SELECT *, (${String(formula).trim()}) AS ${IDENTIFIER(output)} FROM ${from}`;
}
