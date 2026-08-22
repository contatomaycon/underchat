const SAFE_LABEL = /^[a-z0-9][a-z0-9_.:-]{0,159}$/iu;
const SAFE_INTERNAL_ID = /^[a-z0-9][a-z0-9_.:-]{0,159}$/iu;
const SAFE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SENSITIVE_KEYS = new Set([
  'authenticatordata',
  'clientdatajson',
  'credentialid',
  'passkeyconfirmationcode',
  'passkeypublickey',
  'passkeyresponse',
  'pairingcode',
  'publickey',
  'qr',
  'qrcode',
  'rawid',
  'signature',
  'userhandle',
  'webauthnassertion',
]);

const pageHashSalt = (() => {
  try {
    const values = new Uint32Array(2);
    globalThis.crypto?.getRandomValues?.(values);
    if (values[0] || values[1]) return `${values[0]}:${values[1]}`;
  } catch {
    // The fallback is page-local as well; it is never written to the log.
  }
  return `${Date.now()}:${Math.random()}`;
})();

const normalizeKey = (key: string): string =>
  key.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const localHash = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '');
  if (!raw) return '';
  const input = `${pageHashSalt}:${raw}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `localhash:${first.toString(16).padStart(8, '0')}${second
    .toString(16)
    .padStart(8, '0')}`;
};

const metadata = (value: unknown, includeHash = false) => {
  const serialized =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : safeStringify(value);
  return {
    redacted: true,
    present: serialized.length > 0,
    length: serialized.length,
    ...(includeHash && serialized ? { hash: localHash(serialized) } : {}),
  };
};

const isSensitiveKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.includes('passkeyresponse') ||
    normalized.includes('clientdatajson') ||
    normalized.includes('authenticatordata') ||
    normalized.includes('webauthnassertion')
  );
};

const isIdentifierKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    normalized === 'phone' ||
    normalized === 'number' ||
    normalized === 'pn' ||
    normalized === 'lid' ||
    normalized.endsWith('jid') ||
    normalized.endsWith('phonenumber') ||
    normalized === 'participant' ||
    normalized === 'author' ||
    normalized === 'from' ||
    normalized === 'to' ||
    normalized.endsWith('messageid') ||
    normalized.endsWith('chatid') ||
    normalized.endsWith('callid')
  );
};

const isLocationOrCredentialKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    normalized.includes('url') ||
    normalized.includes('dsn') ||
    normalized.includes('connectionstring') ||
    normalized.includes('cookie') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('profile') ||
    (normalized.includes('proxy') && normalized !== 'proxyenabled')
  );
};

const isSafeInternalIdentifierKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    normalized.endsWith('id') ||
    normalized === 'traceid' ||
    normalized === 'connectionepoch' ||
    normalized === 'revisionid'
  );
};

const isSafeLabelKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    normalized === 'event' ||
    normalized === 'layer' ||
    normalized === 'provider' ||
    normalized === 'stage' ||
    normalized === 'status' ||
    normalized === 'state' ||
    normalized === 'reason' ||
    normalized === 'source' ||
    normalized === 'type' ||
    normalized === 'code' ||
    normalized === 'outcome' ||
    normalized === 'classification' ||
    normalized.endsWith('errorcode') ||
    normalized.endsWith('reason')
  );
};

const sanitizeValue = (
  key: string,
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown => {
  if (isSensitiveKey(key)) return metadata(value, true);
  if (isIdentifierKey(key)) return localHash(value);
  if (isLocationOrCredentialKey(key)) return metadata(value);

  if (value instanceof Error) {
    const rawCode = (value as Error & { code?: unknown }).code;
    const code =
      typeof rawCode === 'string' ? rawCode.toLowerCase() : undefined;
    return {
      name: SAFE_LABEL.test(value.name) ? value.name : 'Error',
      ...(code && SAFE_LABEL.test(code) ? { code } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    if (isSafeInternalIdentifierKey(key)) {
      return SAFE_UUID.test(value) || SAFE_INTERNAL_ID.test(value)
        ? value
        : metadata(value, true);
    }
    if (isSafeLabelKey(key)) {
      return SAFE_LABEL.test(value) ? value : metadata(value, true);
    }
    if (
      normalizeKey(key).endsWith('at') &&
      Number.isFinite(Date.parse(value))
    ) {
      return new Date(value).toISOString();
    }
    return metadata(value, true);
  }
  if (typeof value !== 'object') return metadata(String(value), true);
  if (seen.has(value)) return '[circular]';
  if (depth >= 5) return '[max_depth]';
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
};

/** Browser-safe redaction shared by both connection-status debug sinks. */
export const sanitizeConnectionStatusLogContext = (
  context: Record<string, unknown> = {}
): Record<string, unknown> => {
  const seen = new WeakSet<object>();
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = sanitizeValue(key, value, seen, 0);
  }
  return result;
};

export const sanitizeConnectionStatusLogLabel = (
  value: unknown,
  fallback: string
): string =>
  typeof value === 'string' && SAFE_LABEL.test(value) ? value : fallback;
