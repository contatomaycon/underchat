export function extractArrayField(
  field: { value: string | string[] } | undefined
): string[] {
  if (!field) return [];

  const value = field.value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const result: string[] = [];
          for (const item of parsed) {
            if (typeof item === 'string' && item.trim().length > 0) {
              result.push(item.trim());
            }
          }
          return result;
        }
      } catch {
        return [];
      }
    }
    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) {
      return [trimmedValue];
    }
    return [];
  }

  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length === 0) continue;

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              for (const parsedItem of parsed) {
                if (typeof parsedItem === 'string') {
                  const trimmedParsed = parsedItem.trim();
                  if (trimmedParsed.length > 0) {
                    result.push(trimmedParsed);
                  }
                }
              }
              continue;
            }
          } catch {
            result.push(trimmed);
            continue;
          }
        }
        result.push(trimmed);
      }
    }
    return result;
  }

  return [];
}
