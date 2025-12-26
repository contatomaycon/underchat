export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (value && typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string') {
      return new Error(value.message);
    }

    if ('toString' in value && typeof value.toString === 'function') {
      const stringValue = value.toString();
      if (stringValue !== '[object Object]') {
        return new Error(stringValue);
      }
    }

    try {
      return new Error(JSON.stringify(value));
    } catch {
      return new Error('Unknown error');
    }
  }

  if (typeof value === 'string') {
    return new Error(value);
  }

  return new Error(String(value));
}

export function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (value && typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string') {
      return value.message;
    }

    if ('toString' in value && typeof value.toString === 'function') {
      const stringValue = value.toString();
      if (stringValue !== '[object Object]') {
        return stringValue;
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return 'Unknown error';
    }
  }

  if (typeof value === 'string') {
    return value;
  }

  return String(value);
}
