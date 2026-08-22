/**
 * Converts the scalar values accepted by WhatsApp templates to the canonical
 * text representation required by the Meta Message API.
 */
export function normalizeOfficialTemplateVariableValue(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  throw new Error('official_template_variable_value_invalid');
}
