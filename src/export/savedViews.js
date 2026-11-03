// Static query results belong to one set of parameter values. Bounds/order
// do not change those values; an absent or different value does.
export function partitionExportViews(views, parameters) {
  const current = new Map(parameters.map(parameter => [parameter.name, parameter.value]));
  const included = [], excluded = [];
  const display = (values, name) => {
    if (!values.has(name)) return 'not set';
    const text = JSON.stringify(values.get(name));
    return text.length > 80 ? text.slice(0,77) + '…' : text;
  };
  for (const view of views) {
    const saved = new Map((view.parameters || []).map(parameter => [parameter.name, parameter.value]));
    const changed = [...new Set([...current.keys(), ...saved.keys()])].filter(name => !current.has(name) || !saved.has(name) || !Object.is(current.get(name), saved.get(name)));
    if (!changed.length) included.push(view);
    else excluded.push({ name: view.name, reason: 'Different parameter values: ' + changed.map(name => `${name} (saved ${display(saved,name)}; exported ${display(current,name)})`).join(', ') + '.' });
  }
  return { included, excluded };
}
