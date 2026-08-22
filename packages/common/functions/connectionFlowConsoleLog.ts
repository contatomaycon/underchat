import { createHash } from 'node:crypto';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

export type ConnectionFlowFields = Record<string, unknown>;

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
const SAFE_OPERATIONAL_LABEL_PATTERN = /^[a-z][a-z0-9_.:-]{0,159}$/;
const SAFE_INTERNAL_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isIdentifierKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.endsWith('jid') ||
    normalized.endsWith('jidalt') ||
    normalized === 'phone' ||
    normalized.endsWith('phonenumber') ||
    normalized === 'redactedphone' ||
    normalized === 'participant' ||
    normalized === 'author' ||
    normalized === 'from' ||
    normalized === 'to' ||
    normalized.endsWith('messageid') ||
    normalized.endsWith('chatid') ||
    normalized.endsWith('callid')
  );
}

function isLocationOrCredentialKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.includes('url') ||
    normalized.includes('dsn') ||
    normalized.includes('connectionstring') ||
    normalized.includes('cookie') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    (normalized.includes('proxy') && normalized !== 'proxyenabled')
  );
}

function hashIdentifier(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '');
  if (!raw) return '';
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
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
    return '[unserializable]';
  }
}

function redactedStringMetadata(value: string): Record<string, unknown> {
  return {
    redacted: true,
    present: value.length > 0,
    length: value.length,
    sha256: hashIdentifier(value),
  };
}

function isSafeInternalIdentifier(key: string, value: string): boolean {
  if (key === 'revisionid' && /^\d{1,20}$/.test(value)) {
    return true;
  }
  return (
    SAFE_UUID_PATTERN.test(value) ||
    SAFE_INTERNAL_IDENTIFIER_PATTERN.test(value)
  );
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

  if (isIdentifierKey(key)) {
    return hashIdentifier(value);
  }

  if (isLocationOrCredentialKey(key)) {
    return redactedMetadata(value);
  }

  if (value instanceof Error) {
    return workerErrorDiagnostics(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = normalizeKey(key);
    if (
      normalized === 'workerid' ||
      normalized === 'accountid' ||
      normalized === 'sessionid' ||
      normalized === 'traceid' ||
      normalized === 'revisionid' ||
      normalized === 'connectionepoch'
    ) {
      return isSafeInternalIdentifier(normalized, value)
        ? value
        : redactedStringMetadata(value);
    }
    if (
      normalized === 'event' ||
      normalized === 'provider' ||
      normalized === 'stage' ||
      normalized === 'status' ||
      normalized === 'state' ||
      normalized === 'reason' ||
      normalized === 'source' ||
      normalized === 'type' ||
      normalized.endsWith('errorcode')
    ) {
      return SAFE_OPERATIONAL_LABEL_PATTERN.test(value)
        ? value
        : redactedStringMetadata(value);
    }
    return redactedStringMetadata(value);
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
  const payload: ConnectionFlowFields = {
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeConnectionFlowFields(fields),
  };

  try {
    console.log('[CONNECTION_FLOW]', JSON.stringify(payload));
  } catch (error) {
    console.log('[CONNECTION_FLOW]', event, {
      serialization_error: workerErrorDiagnostics(error),
    });
  }
}

/**
 * Applies the same fail-closed redaction policy to every connection lifecycle
 * sink. Keeping this separate from the console writer prevents a second sink
 * from accidentally emitting the unsanitized context that was passed to the
 * primary connection-flow log.
 */
export function sanitizeConnectionFlowFields(
  fields: ConnectionFlowFields = {}
): ConnectionFlowFields {
  const seen = new WeakSet<object>();
  const sanitized: ConnectionFlowFields = {};

  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value, seen, 0);
  }

  return sanitized;
}
