import { LIMITS } from './limits.js';

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const shape = (value, allowed, label) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid ${label}.`);
};
const scalarDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
};
/** Enumerate bounded, deterministic string options from a pinned column. */
export function enumerateParameterOptions(rows, column) {
  if (!Array.isArray(rows) || rows.length > LIMITS.rows || typeof column !== 'string' || !column || column.length > 200) throw new Error('Invalid select option source.');
  const options = [], seen = new Set();
  let distinctCount = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !own(row, column) || row[column] == null || !['string', 'number', 'boolean'].includes(typeof row[column])) continue;
    const value = String(row[column]);
    if (seen.has(value)) continue;
    seen.add(value);
    distinctCount++;
    if (options.length < 200) options.push(value);
  }
  return { options, ...(distinctCount > 200 ? { overflow: { distinctCount } } : {}) };
}

/** Validate saved what-if parameters and return a plain, bounded copy. */
export function validateParameters(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid parameters.');
  const names = new Set();
  return input.map(parameter => {
    if (!object(parameter) || typeof parameter.name !== 'string' || !namePattern.test(parameter.name) || names.has(parameter.name)) throw new Error('Invalid or duplicate parameter name.');
    names.add(parameter.name);
    if (parameter.type === 'number') {
      shape(parameter, ['name','type','value','min','max','step','integer'], `number parameter ${parameter.name}`);
      if (typeof parameter.value !== 'number' || !Number.isFinite(parameter.value)) throw new Error(`Invalid numeric parameter ${parameter.name}.`);
      const result = { name: parameter.name, type: 'number', value: parameter.value };
      for (const key of ['min', 'max']) {
        if (parameter[key] !== undefined && (typeof parameter[key] !== 'number' || !Number.isFinite(parameter[key]))) throw new Error(`Invalid parameter ${key}: ${parameter.name}.`);
        if (parameter[key] !== undefined) result[key] = parameter[key];
      }
      if (parameter.step !== undefined) {
        if (typeof parameter.step !== 'number' || !Number.isFinite(parameter.step) || parameter.step <= 0) throw new Error(`Invalid parameter step: ${parameter.name}.`);
        result.step = parameter.step;
      }
      if (parameter.integer !== undefined && typeof parameter.integer !== 'boolean') throw new Error(`Invalid parameter integer setting: ${parameter.name}.`);
      if (parameter.integer !== undefined) result.integer = parameter.integer;
      if ((result.min !== undefined && result.max !== undefined && result.min > result.max) || (result.min !== undefined && result.value < result.min) || (result.max !== undefined && result.value > result.max)) throw new Error(`Parameter ${parameter.name} is outside its range.`);
      if (result.integer && (!Number.isInteger(result.value) || result.step !== undefined && !Number.isInteger(result.step))) throw new Error(`Parameter ${parameter.name} must use integral values and step.`);
      return result;
    }
    if (parameter.type === 'text' && typeof parameter.value === 'string' && parameter.value.length <= 10000) { shape(parameter,['name','type','value'],`text parameter ${parameter.name}`); return { name: parameter.name, type: 'text', value: parameter.value }; }
    if (parameter.type === 'boolean' && typeof parameter.value === 'boolean') { shape(parameter,['name','type','value'],`boolean parameter ${parameter.name}`); return { name: parameter.name, type: 'boolean', value: parameter.value }; }
    if (parameter.type === 'date' && scalarDate(parameter.value)) { shape(parameter,['name','type','value'],`date parameter ${parameter.name}`); return { name: parameter.name, type: 'date', value: parameter.value }; }
    if (parameter.type === 'date-range' || parameter.type === 'number-range') {
      shape(parameter,['name','type','value'],`${parameter.type} parameter ${parameter.name}`);
      const isDate = parameter.type === 'date-range', value = parameter.value;
      if (!object(value) || Object.keys(value).some(key => !['from', 'to'].includes(key)) || !own(value, 'from') || !own(value, 'to')) throw new Error(`Invalid ${parameter.type} parameter ${parameter.name}.`);
      const valid = bound => bound === null || (isDate ? scalarDate(bound) : typeof bound === 'number' && Number.isFinite(bound));
      if (!valid(value.from) || !valid(value.to) || value.from === null && value.to === null || value.from !== null && value.to !== null && value.from > value.to) throw new Error(`Invalid ${parameter.type} bounds for ${parameter.name}.`);
      return { name: parameter.name, type: parameter.type, value: { from: value.from, to: value.to } };
    }
    if (parameter.type === 'single-select' || parameter.type === 'multi-select') {
      shape(parameter,['name','type','value','source','options','overflow','stale','staleValues'],`${parameter.type} parameter ${parameter.name}`);
      const single = parameter.type === 'single-select';
      const valueValid = single ? typeof parameter.value === 'string' : Array.isArray(parameter.value) && parameter.value.length <= 200 && parameter.value.every(value => typeof value === 'string') && new Set(parameter.value).size === parameter.value.length;
      if (!valueValid || !object(parameter.source) || Object.keys(parameter.source).some(key => !['dataset', 'column'].includes(key)) || typeof parameter.source.dataset !== 'string' || typeof parameter.source.column !== 'string' || !parameter.source.column || parameter.source.column.length > 200 || !Array.isArray(parameter.options) || parameter.options.length > 200 || parameter.options.some(value => typeof value !== 'string') || new Set(parameter.options).size !== parameter.options.length) throw new Error(`Invalid ${parameter.type} parameter ${parameter.name}.`);
      let overflow;
      if (parameter.overflow !== undefined) {
        if (!object(parameter.overflow) || Object.keys(parameter.overflow).length !== 1 || !Number.isInteger(parameter.overflow.distinctCount) || parameter.overflow.distinctCount <= 200 || parameter.overflow.distinctCount > LIMITS.rows || parameter.options.length !== 200) throw new Error(`Invalid select overflow state for ${parameter.name}.`);
        overflow = { distinctCount: parameter.overflow.distinctCount };
      }
      if ((single && parameter.stale !== undefined && typeof parameter.stale !== 'boolean') || (!single && parameter.staleValues !== undefined && (!Array.isArray(parameter.staleValues) || parameter.staleValues.length > 200 || parameter.staleValues.some(value => typeof value !== 'string')))) throw new Error(`Invalid stale select state for ${parameter.name}.`);
      const options = [...parameter.options], optionSet = new Set(options);
      const stale = single ? !optionSet.has(parameter.value) : parameter.value.filter(value => !optionSet.has(value));
      return { name: parameter.name, type: parameter.type, value: single ? parameter.value : [...parameter.value], source: { dataset: parameter.source.dataset, column: parameter.source.column }, options, ...(overflow ? { overflow } : {}), ...(single ? { stale } : { staleValues: stale }) };
    }
    throw new Error(`Invalid parameter ${parameter.name}: unknown type ${String(parameter.type)}.`);
  });
}

export { substituteParameters } from './parameterSql.js';
