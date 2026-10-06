const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate saved what-if parameters and return a plain, bounded copy. */
export function validateParameters(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) throw new Error("Invalid parameters.");
  const names = new Set();
  return input.map(parameter => {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter) || typeof parameter.name !== "string" || !namePattern.test(parameter.name) || names.has(parameter.name)) throw new Error("Invalid or duplicate parameter name.");
    names.add(parameter.name);
    if (parameter.type === "number") {
      if (typeof parameter.value !== "number" || !Number.isFinite(parameter.value)) throw new Error(`Invalid numeric parameter ${parameter.name}.`);
      const result = { name: parameter.name, type: "number", value: parameter.value };
      for (const key of ["min", "max"]) {
        if (parameter[key] !== undefined && (typeof parameter[key] !== "number" || !Number.isFinite(parameter[key]))) throw new Error(`Invalid parameter ${key}: ${parameter.name}.`);
        if (parameter[key] !== undefined) result[key] = parameter[key];
      }
      if (result.min !== undefined && result.max !== undefined && result.min > result.max || result.min !== undefined && result.value < result.min || result.max !== undefined && result.value > result.max) throw new Error(`Parameter ${parameter.name} is outside its range.`);
      return result;
    }
    if (parameter.type === "text" && typeof parameter.value === "string" && parameter.value.length <= 10000) {
      return { name: parameter.name, type: "text", value: parameter.value };
    }
    throw new Error(`Invalid parameter ${parameter.name}.`);
  });
}

/** Replace {{name}} with a safe SQL number or escaped string literal. */
export function substituteParameters(sql, parameters = []) {
  if (typeof sql !== "string") throw new Error("SQL must be text.");
  const byName = new Map(validateParameters(parameters).map(parameter => [parameter.name, parameter]));
  return sql.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (placeholder, name) => {
    const parameter = byName.get(name);
    if (!parameter) throw new Error(`Unknown SQL parameter "${name}". Add it in Filters → Parameters.`);
    return parameter.type === "number" ? String(parameter.value) : `'${parameter.value.replace(/'/g, "''")}'`;
  });
}
