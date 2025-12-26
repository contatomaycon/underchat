function extractErrorMessage(value: unknown): string | null {
  if (value instanceof Error) {
    return value.message;
  }

  if (value && typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string') {
      return value.message;
    }

    if ('toString' in value && typeof value.toString === 'function') {
      try {
        const stringValue = value.toString();
        if (stringValue && stringValue !== '[object Object]') {
          return stringValue;
        }
      } catch {}
    }

    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  if (typeof value === 'string') {
    return value;
  }

  return null;
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  const errorMessage = extractErrorMessage(value);
  if (errorMessage) {
    return new Error(errorMessage);
  }

  return new Error('Unknown error');
}

export function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  const errorMessage = extractErrorMessage(value);
  return errorMessage ?? 'Unknown error';
}
