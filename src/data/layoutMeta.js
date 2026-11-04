// Optional dashboard metadata (UX-7 D1): collected at share time, stored on
// the layout as `meta`, never inferred from accounts, filenames or clocks.

export const META_FIELDS = ['title', 'preparedBy', 'dataPeriod'];
export const META_MAX_LENGTH = 200;

/**
 * Validate the optional layout `meta` object (D1). Absent stays absent;
 * present values must be strings within the length cap. Unknown keys are
 * dropped, matching how validateLayout treats the rest of the layout.
 */
export function validateLayoutMeta(input) {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid dashboard metadata.');
  const meta = {};
  for (const key of META_FIELDS) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > META_MAX_LENGTH) throw new Error(`Invalid dashboard metadata: ${key}.`);
    meta[key] = value;
  }
  return meta;
}

/** Collected values from the share modal: trimmed, capped, undefined when all blank. */
export function metaFromInputs(values) {
  const meta = {};
  for (const key of META_FIELDS) meta[key] = String(values?.[key] ?? '').trim().slice(0, META_MAX_LENGTH);
  return META_FIELDS.some(key => meta[key]) ? meta : undefined;
}

/** Explicit viewer fallbacks (V1): nothing is inferred from anything else. */
export function exportMetaFacts(meta) {
  const value = key => (typeof meta?.[key] === 'string' ? meta[key].trim() : '');
  return {
    title: value('title') || 'Untitled dashboard',
    preparedBy: value('preparedBy') || 'Not provided',
    dataPeriod: value('dataPeriod') || 'Not specified'
  };
}
