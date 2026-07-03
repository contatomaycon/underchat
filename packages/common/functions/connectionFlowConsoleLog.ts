type ConnectionFlowFields = Record<string, unknown>;

const SENSITIVE_KEYS = new Set([
  'authenticatordata',
  'clientdatajson',
  'credentialid',
  'passkeyconfirmationcode',
  'passkeypublickey',
  'passkeyresponse',
  'passkeysecret',
  'pairingcode',
  'publickey',
  'qrcode',
  'qr',
  'qrcode',
  'rawid',
  'signature',
  'userhandle',
  'webauthnassertion',
]);

function normalizeKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.includes('passkeyresponse') ||
    normalized.includes('clientdatajson') ||
    normalized.includes('authenticatordata') ||
    normalized.includes('webauthnassertion')
  );
}

function redactedMetadata(value: unknown): Record<string, unknown> {
  const present =
    value !== undefined &&
    value !== null &&
    !(typeof value === 'string' && value.length === 0);
  const length =
    typeof value === 'string'
      ? value.length
      : present
        ? safeStringify(value).length
        : 0;

  return {
    redacted: true,
    present,
    length,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeValue(
  key: string,
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (isSensitiveKey(key)) {
    return redactedMetadata(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[circular]';
  }

  if (depth >= 4) {
    return '[max_depth]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item, index) =>
        sanitizeValue(String(index), item, seen, depth + 1)
      );
  }

  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    output[childKey] = sanitizeValue(childKey, childValue, seen, depth + 1);
  }
  return output;
}

export function logConnectionFlowConsole(
  event: string,
  fields: ConnectionFlowFields = {}
): void {
  const seen = new WeakSet<object>();
  const payload: ConnectionFlowFields = {
    event,
    timestamp: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(fields)) {
    payload[key] = sanitizeValue(key, value, seen, 0);
  }

  try {
    console.log('[CONNECTION_FLOW]', JSON.stringify(payload));
  } catch (error) {
    console.log('[CONNECTION_FLOW]', event, {
      serialization_error:
        error instanceof Error ? error.message : String(error),
    });
  }
}
