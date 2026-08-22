const MAX_SERIALIZED_JSON_DEPTH = 2;
const MAX_DISPLAY_STRUCTURE_DEPTH = 12;
const RESPONSE_BODY_KEYS = new Set(['responseBody', 'response_body']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Decodes response bodies that may have been serialized once or twice by an
 * upstream service. Invalid JSON is deliberately returned unchanged so plain
 * text and multiline responses keep their original representation.
 */
export const parseSerializedJson = (value: unknown): unknown => {
  let parsedValue = value;

  for (let depth = 0; depth < MAX_SERIALIZED_JSON_DEPTH; depth += 1) {
    if (typeof parsedValue !== 'string' || !parsedValue.trim()) break;

    try {
      parsedValue = JSON.parse(parsedValue) as unknown;
    } catch {
      break;
    }
  }

  return parsedValue;
};

const normalizeNestedResponseBodies = (
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown => {
  if (depth > MAX_DISPLAY_STRUCTURE_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const normalizedItems = value.map((item) =>
      normalizeNestedResponseBodies(item, seen, depth + 1)
    );
    seen.delete(value);
    return normalizedItems;
  }

  if (!isRecord(value)) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  const normalizedRecord = Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedItem = RESPONSE_BODY_KEYS.has(key)
        ? parseSerializedJson(item)
        : item;

      return [
        key,
        normalizeNestedResponseBodies(normalizedItem, seen, depth + 1),
      ];
    })
  );
  seen.delete(value);
  return normalizedRecord;
};

export const formatJsonForDisplay = (
  value: unknown,
  emptyContent: string
): string => {
  if (value === null || value === undefined) return emptyContent;

  const parsedValue = normalizeNestedResponseBodies(
    parseSerializedJson(value),
    new WeakSet<object>(),
    0
  );
  if (typeof parsedValue === 'string') return parsedValue;

  try {
    return JSON.stringify(parsedValue, null, 2) ?? String(parsedValue);
  } catch {
    return String(parsedValue);
  }
};
