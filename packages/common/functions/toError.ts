function extractMessageFromObject(value: object): string | null {
  if ('message' in value && typeof value.message === 'string') {
    return value.message;
  }

  return null;
}

function extractStringFromObject(value: object): string | null {
  if ('toString' in value && typeof value.toString === 'function') {
    try {
      const stringValue = value.toString();
      if (
        typeof stringValue === 'string' &&
        stringValue.length > 0 &&
        stringValue !== '[object Object]'
      ) {
        return stringValue;
      }
    } catch {}
  }

  return null;
}

function extractJsonFromObject(value: object): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractErrorMessageFromObject(value: object): string | null {
  const message = extractMessageFromObject(value);
  if (message) {
    return message;
  }

  const stringValue = extractStringFromObject(value);
  if (stringValue) {
    return stringValue;
  }

  return extractJsonFromObject(value);
}

function extractErrorMessage(value: unknown): string | null {
  if (value instanceof Error) {
    return value.message;
  }

  if (value && typeof value === 'object') {
    return extractErrorMessageFromObject(value);
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
