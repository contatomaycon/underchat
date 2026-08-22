function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unwrapMultipartValue(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    return null;
  }

  const wrappedValue = (value as { value?: unknown }).value;
  return typeof wrappedValue === 'string' && wrappedValue.length > 0
    ? wrappedValue
    : null;
}

/**
 * Collects multipart fields such as `sector_ids[2]` without allocating a
 * sparse array based on an untrusted index.
 */
export function extractIndexedMultipartValues(
  input: Record<string, unknown>,
  fieldName: string
): string[] {
  const pattern = new RegExp(`^${escapeRegExp(fieldName)}\\[(\\d+)\\]$`);
  const valuesByIndex = new Map<number, string>();

  for (const [key, field] of Object.entries(input)) {
    const match = pattern.exec(key);
    if (!match) continue;

    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0) continue;

    const value = unwrapMultipartValue(field);
    if (value !== null) valuesByIndex.set(index, value);
  }

  return [...valuesByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
}
