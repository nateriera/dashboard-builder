const same = (left, right) => Object.is(left, right);

export function parameterFilterBinding(parameter) {
  return parameter?.bindings?.find(binding => binding.kind === 'filter') || null;
}

export function bindingFilterValues(parameter) {
  const value = parameter?.value;
  if (parameter?.type === 'number-range' || parameter?.type === 'date-range') {
    if (value?.from == null || value?.to == null) return null;
    return [value.from, value.to];
  }
  if (parameter?.type === 'multi-select') return [...value];
  return [value];
}

export function parameterValueFromFilter(parameter, filter) {
  if (parameter.type === 'number-range' || parameter.type === 'date-range') {
    if (filter.values.length !== 2) return { conflict: 'A range binding needs both filter bounds.' };
    return { value: { from: filter.values[0], to: filter.values[1] } };
  }
  if (parameter.type === 'multi-select') return { value: [...filter.values] };
  if (filter.values.length !== 1) return { conflict: 'This binding needs exactly one selected filter value.' };
  return { value: filter.values[0] };
}

export function bindingConflict(parameter, filter) {
  if (!filter) return `Bound filter ${parameter.bindings?.[0]?.filterId || '(missing)'} is unavailable.`;
  const values = bindingFilterValues(parameter);
  if (!values) return 'A bound range needs both ends; the filter was left unchanged.';
  const expected = parameter.type === 'multi-select'
    ? [...values].sort((a,b)=>String(a).localeCompare(String(b)))
    : values;
  const actual = parameter.type === 'multi-select'
    ? [...filter.values].sort((a,b)=>String(a).localeCompare(String(b)))
    : filter.values;
  if (expected.length !== actual.length || expected.some((value,index)=>!same(value,actual[index]))) return 'The parameter value and bound filter values disagree.';
  return null;
}

export function bindingCompatibilityError(parameter, filter, fieldInfos) {
  const label = `Parameter ${parameter.name} cannot bind to filter ${filter?.field || parameter.bindings?.[0]?.filterId || '(unknown)'}`;
  if (!filter || filter.source === 'crossfilter') return `${label}: choose a dashboard filter.`;
  const type = parameter.type;
  const scalar = ['number','text','boolean','date','single-select'].includes(type);
  const multi = type === 'multi-select';
  const numberRange = type === 'number-range';
  const dateRange = type === 'date-range';
  const validOperator = scalar || multi
    ? ['is','is-not'].includes(filter.op)
    : numberRange ? filter.op === 'between' : dateRange && filter.op === 'date-between';
  if (!validOperator) return `${label}: ${type} requires a ${numberRange||dateRange?'matching range':'single-value'} filter.`;
  if (!Array.isArray(fieldInfos) || !fieldInfos.length || fieldInfos.some(info=>!info?.checkable)) return `${label}: the target field values cannot be checked, so this binding was refused.`;
  const expectedType = type === 'number' || numberRange ? 'number' : type === 'date' || dateRange ? 'date' : type === 'boolean' ? 'boolean' : 'text';
  for (const info of fieldInfos) {
    const valueTypes = info.valueTypes || [];
    const typeMatches=expectedType==='text'?['category','text'].includes(info.type):expectedType==='boolean'?['category','boolean'].includes(info.type):info.type===expectedType;
    if (!typeMatches) return `${label}: ${type} requires a ${expectedType} target field; ${info.field || filter.field} is ${info.type || 'unknown'}.`;
    if (expectedType === 'text' && valueTypes.some(valueType=>valueType!=='string')) return `${label}: text/select bindings require text values in ${info.field || filter.field}.`;
    if (expectedType === 'boolean' && valueTypes.some(valueType=>valueType!=='boolean')) return `${label}: boolean bindings require boolean values in ${info.field || filter.field}.`;
    if (expectedType === 'number' && (info.numericCompatible===false || valueTypes.some(valueType=>!['number','string'].includes(valueType)))) return `${label}: numeric bindings require numeric values in ${info.field || filter.field}.`;
    if (expectedType === 'date' && info.dateCompatible===false) return `${label}: date bindings require YYYY-MM-DD values in ${info.field || filter.field}.`;
  }
  return null;
}

export function validateParameterBindings(parameters, filters, resolveFieldInfos) {
  const filterIds = new Set(filters.map(filter=>filter.id));
  const owners = new Map();
  for (const parameter of parameters) {
    const binding = parameterFilterBinding(parameter);
    if (!binding) continue;
    if (!filterIds.has(binding.filterId)) throw new Error(`Parameter ${parameter.name} is bound to missing filter ${binding.filterId}.`);
    const prior = owners.get(binding.filterId);
    if (prior) throw new Error(`Parameters ${prior} and ${parameter.name} cannot both bind to filter ${binding.filterId}.`);
    owners.set(binding.filterId,parameter.name);
    const filter = filters.find(item=>item.id===binding.filterId);
    const error = bindingCompatibilityError(parameter,filter,resolveFieldInfos?.(filter) || null);
    if (error) throw new Error(error);
  }
  return parameters;
}
