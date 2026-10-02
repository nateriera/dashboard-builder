const SAMPLE_LIMIT = 5000;
const DISTINCT_LIMIT = 101;
const IDENTIFIER_NAME = /(^|[ _-])(id|uuid|guid|code|zip|fips|postal|key|account)([ _-]|$)|(?:id|uuid|guid|code|fips|zip|key)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$)/;

function missing(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function dateValue(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value.trim())) return false;
  return Number.isFinite(Date.parse(value.trim()));
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || !value.trim()) return false;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) {
    try {
      const integer = BigInt(text);
      if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) return false;
    } catch { return false; }
  }
  return Number.isFinite(Number(text));
}

/** Profile uploaded rows locally. Missing counts are exact; type inference
 * samples at most 5,000 evenly spaced rows and reports that bounded method. */
export function profileRows(columns, rows) {
  const stride = Math.max(1, Math.ceil(rows.length / SAMPLE_LIMIT));
  const sample = [];
  for (let i = 0; i < rows.length; i += stride) sample.push(rows[i]);
  if (sample.length > SAMPLE_LIMIT) sample.length = SAMPLE_LIMIT;

  const fields = columns.map((name) => {
    let missingCount = 0;
    const distinct = new Set();
    let distinctOverLimit = false;
    for (const row of rows) {
      const value = row[name];
      if (missing(value)) missingCount++;
      else if (!distinctOverLimit) {
        distinct.add(String(value));
        if (distinct.size >= DISTINCT_LIMIT) { distinctOverLimit = true; distinct.clear(); }
      }
    }

    const values = sample.map((row) => row[name]).filter((value) => !missing(value));
    const distinctCount = distinctOverLimit ? null : distinct.size;
    const numericCount = values.reduce((n, value) => n + (numericValue(value) ? 1 : 0), 0);
    const dateCount = values.reduce((n, value) => n + (dateValue(value) ? 1 : 0), 0);
    const enough = values.length > 0;
    let kind;
    if (!enough) kind = "empty";
    else if (IDENTIFIER_NAME.test(name)) kind = "identifier";
    else if (numericCount / values.length >= 0.9) kind = "number";
    else if (dateCount / values.length >= 0.9) kind = "date";
    else if (distinctCount !== null && distinctCount <= 100) kind = "category";
    else kind = "high-cardinality";

    let uniqueDates = null;
    if (kind === "date") {
      uniqueDates = true;
      const seenDates = new Set();
      for (const row of rows) {
        const value = row[name];
        if (missing(value)) continue;
        const timestamp = Date.parse(String(value).trim());
        if (seenDates.has(timestamp)) { uniqueDates = false; break; }
        seenDates.add(timestamp);
      }
    }
    return { name, kind, missingCount, distinctCount, uniqueDates, sampledRows: sample.length };
  });

  return { rowCount: rows.length, sampledRows: sample.length, fields };
}
