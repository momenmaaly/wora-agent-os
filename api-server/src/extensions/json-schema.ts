/**
 * Bounded JSON Schema validation for plugin tool inputs.
 *
 * Manifests are untrusted, so this validator never evaluates references,
 * formats, or regular expressions supplied by a package. It supports the
 * structural keywords WORA itself emits and ignores unknown keywords.
 */
export function validateAgainstSchema(schema: unknown, value: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const node = schema as Record<string, unknown>;
  const errors: string[] = [];
  const type = node['type'];
  if (typeof type === 'string' && !matchesType(type, value)) {
    errors.push(`${path}: expected ${type}`);
    return errors;
  }
  if (Array.isArray(node['enum']) && node['enum'].length > 0 && !node['enum'].some((entry) => deepEqual(entry, value))) {
    errors.push(`${path}: must be one of the declared values`);
  }
  if (typeof value === 'string') {
    if (typeof node['minLength'] === 'number' && value.length < node['minLength']) errors.push(`${path}: shorter than ${node['minLength']}`);
    if (typeof node['maxLength'] === 'number' && value.length > node['maxLength']) errors.push(`${path}: longer than ${node['maxLength']}`);
    if (typeof node['pattern'] === 'string' && node['pattern'].length <= 200) {
      try { if (!new RegExp(node['pattern'], 'u').test(value)) errors.push(`${path}: does not match the required pattern`); }
      catch { /* an invalid pattern is ignored, never executed as code */ }
    }
  }
  if (typeof value === 'number') {
    if (typeof node['minimum'] === 'number' && value < node['minimum']) errors.push(`${path}: below minimum`);
    if (typeof node['maximum'] === 'number' && value > node['maximum']) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof node['minItems'] === 'number' && value.length < node['minItems']) errors.push(`${path}: fewer than ${node['minItems']} items`);
    if (typeof node['maxItems'] === 'number' && value.length > node['maxItems']) errors.push(`${path}: more than ${node['maxItems']} items`);
    const items = node['items'];
    if (items && typeof items === 'object') value.slice(0, 100).forEach((entry, index) => errors.push(...validateAgainstSchema(items, entry, `${path}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = node['properties'] && typeof node['properties'] === 'object' ? node['properties'] as Record<string, unknown> : {};
    const required = Array.isArray(node['required']) ? node['required'].filter((entry): entry is string => typeof entry === 'string') : [];
    for (const key of required) if (!(key in record)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(properties).slice(0, 100)) {
      if (key in record) errors.push(...validateAgainstSchema(child, record[key], `${path}.${key}`));
    }
    if (node['additionalProperties'] === false) {
      for (const key of Object.keys(record)) if (!(key in properties)) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

function matchesType(type: string, value: unknown): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}
