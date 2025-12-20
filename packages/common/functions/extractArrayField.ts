function parseJsonArray(trimmed: string): string[] {
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const result: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim().length > 0) {
        result.push(item.trim());
      }
    }
    return result;
  } catch {
    return [];
  }
}

function processStringValue(value: string): string[] {
  const trimmed = value.trim();

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const parsed = parseJsonArray(trimmed);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  if (trimmed.length > 0) {
    return [trimmed];
  }

  return [];
}

function processArrayItem(item: string, result: string[]): void {
  const trimmed = item.trim();
  if (trimmed.length === 0) {
    return;
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const parsed = parseJsonArray(trimmed);
    if (parsed.length > 0) {
      for (const parsedItem of parsed) {
        result.push(parsedItem);
      }
      return;
    }
  }

  result.push(trimmed);
}

function processArrayValue(value: string[]): string[] {
  const result: string[] = [];

  for (const item of value) {
    if (typeof item === 'string') {
      processArrayItem(item, result);
    }
  }

  return result;
}

export function extractArrayField(
  field: { value: string | string[] } | undefined
): string[] {
  if (!field) {
    return [];
  }

  const value = field.value;

  if (typeof value === 'string') {
    return processStringValue(value);
  }

  if (Array.isArray(value)) {
    return processArrayValue(value);
  }

  return [];
}
