const own = (value, key) => value != null && Object.hasOwn(value, key);
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const datePattern = /^\d{4}-\d{2}(?:-\d{2})?(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?: ?Z|[+-]\d{2}:\d{2})?)?$/;

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calendarDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || !datePattern.test(value.trim())) return null;
  const match = /^(\d{4}-\d{2})(?:-(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2] || "01"}`;
  return validCalendarDate(date) ? date : null;
}

function validField(field) {
  return typeof field === "string" && field.length > 0 && field.length <= 200 && !forbidden.has(field);
}

function validValue(value) {
  return value === null || typeof value === "string" && value.length <= 200 || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

/** Validate persisted dashboard filters without mutating the caller's input. */
export function validateFilters(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) throw new Error("Invalid filters.");
  let crossfilterCount = 0;
  return input.map(filter => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter) || !idPattern.test(filter.id || "") || !validField(filter.field)) throw new Error("Invalid filter.");
    if (!Array.isArray(filter.values) || filter.values.length === 0 || filter.values.length > 200 || filter.values.some(value => !validValue(value))) throw new Error("Invalid filter values.");
    if (filter.op === "between") {
      if (filter.values.length !== 2 || filter.values.some(value => typeof value !== "number") || filter.values[0] > filter.values[1]) throw new Error("Invalid numeric filter range.");
    } else if (filter.op === "date-between") {
      if (filter.values.length !== 2 || !filter.values.every(validCalendarDate) || filter.values[0] > filter.values[1]) throw new Error("Invalid date filter range.");
    } else if (!["is", "is-not"].includes(filter.op)) {
      throw new Error("Invalid filter operator.");
    }
    const result = { id: filter.id, field: filter.field, op: filter.op, values: [...filter.values] };
    if (filter.targets !== undefined) {
      if (!Array.isArray(filter.targets) || filter.targets.length === 0 || filter.targets.length > 100) throw new Error("Invalid filter connections.");
      const seenTiles = new Set();
      result.targets = filter.targets.map(target => {
        if (!target || typeof target !== "object" || Array.isArray(target) || !idPattern.test(target.tileId || "") || !validField(target.field) || seenTiles.has(target.tileId)) throw new Error("Invalid filter connection.");
        seenTiles.add(target.tileId);
        return { tileId: target.tileId, field: target.field };
      });
    }
    if (filter.source !== undefined) {
      if (filter.source !== "crossfilter" || filter.op !== "is" || filter.targets !== undefined || !idPattern.test(filter.sourceTile || "") || ++crossfilterCount > 1) throw new Error("Invalid cross-filter source.");
      result.source = "crossfilter";
      result.sourceTile = filter.sourceTile;
    } else if (filter.sourceTile !== undefined) {
      throw new Error("Invalid filter source tile.");
    }
    return result;
  });
}

function sameValue(a, b) {
  return Object.is(a, b);
}

function numericFilterValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n)) return null;
  return n;
}

/** Apply filters only when a tile's resolved rows contain the named field. */
export function applyFilters(rows, filters = [], { sourceTile = null } = {}) {
  let result = rows;
  let applied = false;
  let appliedCount = 0;
  for (const filter of filters) {
    if (filter.source === "crossfilter" && filter.sourceTile === sourceTile) continue;
    const connection = filter.targets?.find(target => target.tileId === sourceTile);
    if (filter.targets && !connection) continue;
    const field = connection?.field || filter.field;
    if (!rows.some(row => own(row, field))) continue;
    applied = true;
    appliedCount++;
    result = result.filter(row => {
      if (!own(row, field)) return true;
      const value = row[field];
      if (filter.op === "between") {
        const numeric = numericFilterValue(value);
        return numeric !== null && numeric >= filter.values[0] && numeric <= filter.values[1];
      }
      if (filter.op === "date-between") {
        const date = calendarDate(value);
        return date !== null && date >= filter.values[0] && date <= filter.values[1];
      }
      const selected = filter.values.some(candidate => sameValue(candidate, value));
      return filter.op === "is" ? selected : !selected;
    });
  }
  return { rows: result, applied, appliedCount };
}

function scalarKey(value) {
  return `${value === null ? "null" : typeof value}:${JSON.stringify(value)}`;
}

/** Return at most `limit` distinct primitive values plus an overflow flag. */
export function distinctValues(rows, field, limit = 200) {
  const values = [], seen = new Set();
  for (const row of rows) {
    if (!own(row, field)) continue;
    const value = row[field];
    if (!validValue(value)) continue;
    const key = scalarKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    if (values.length === limit) return { values, truncated: true };
    values.push(value);
  }
  return { values, truncated: false };
}

function isDateValue(value) {
  return calendarDate(value) !== null;
}

/** Infer a filter control for a source field. */
export function filterFieldType(rows, field) {
  const values = rows.filter(row => own(row, field)).map(row => row[field]).filter(value => value !== null && value !== "");
  if (values.length && values.every(isDateValue)) return "date";
  // Keep identifier-shaped columns categorical even when their strings look
  // numeric (for example FIPS, postal codes, and source record IDs).
  if (/(^|[^a-z0-9])(?:id|fips|code|zip|postal(?:code)?)(?:$|[^a-z0-9])/i.test(field)) return "category";
  const numericCount = values.filter(value => numericFilterValue(value) !== null).length;
  const allNumeric = values.length > 0 && numericCount === values.length;
  const mostlyNumericWithNumbers = values.some(value => typeof value === "number") && numericCount / values.length >= 0.8;
  if (allNumeric || mostlyNumericWithNumbers) return "number";
  return "category";
}

function valueKey(value) {
  return scalarKey(value);
}

/** Order categories by their numeric total, then return the selected rows. */
export function sortAndLimitRows(type, rows, { sort = "desc", topN = null } = {}) {
  if (!Array.isArray(rows)) throw new Error("Chart rows must be an array.");
  if (!["desc", "asc", "data"].includes(sort)) throw new Error("Unsupported chart sort.");
  const categoryField = type.startsWith("stacked") ? "label" : "label";
  const valueField = "value";
  const totals = new Map();
  const order = [];
  for (const row of rows) {
    const key = valueKey(row[categoryField]);
    if (!totals.has(key)) { totals.set(key, { value: 0, rows: [] }); order.push(key); }
    const group = totals.get(key);
    group.rows.push(row);
    const value = row[valueField];
    if (typeof value === "number" && Number.isFinite(value)) group.value += value;
  }

  const stack = type === "stackedBar" || type === "stackedColumn";
  const shouldRank = !stack || topN != null;
  let ranked = [...order];
  if (shouldRank && sort !== "data") {
    const sourcePosition = new Map(order.map((key, index) => [key, index]));
    ranked.sort((a, b) => {
      const difference = totals.get(a).value - totals.get(b).value;
      return (sort === "asc" ? difference : -difference) || sourcePosition.get(a) - sourcePosition.get(b);
    });
  }
  if (topN == null) {
    if (!shouldRank || sort === "data") return rows.slice();
    return ranked.flatMap(key => totals.get(key).rows);
  }
  const limit = Math.min(100, Math.max(1, Math.round(Number(topN) || 1)));
  return ranked.slice(0, limit).flatMap(key => totals.get(key).rows);
}
