import { createHash } from 'crypto';
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';

const LOG_PREFIX = '[LOCAL_CONNECTION_STATUS]';
let localSequence = 0;

export type LocalConnectionStatusLogContext = Record<string, unknown>;

export function isLocalConnectionStatusLogEnabled(): boolean {
  return process.env.APP_ENVIRONMENT === EAppEnvironment.local;
}

export function logLocalConnectionStatus(
  event: string,
  context: LocalConnectionStatusLogContext = {}
): void {
  if (!isLocalConnectionStatusLogEnabled()) {
    return;
  }

  localSequence += 1;
  const sanitizedContext = sanitizeObject(context, 0);
  if (sanitizedContext.event !== undefined) {
    sanitizedContext.source_event = sanitizedContext.event;
    delete sanitizedContext.event;
  }

  const payload = stabilizePayload({
    seq: localSequence,
    event,
    layer: sanitizedContext.layer ?? 'node',
    timestamp: new Date().toISOString(),
    ...sanitizedContext,
  });

  console.log(LOG_PREFIX, JSON.stringify(payload));
}

function sanitizeObject(
  input: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  if (depth > 5) {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isQrKey(key)) {
      Object.assign(output, secureStringMetadata('qr', value));
      continue;
    }

    if (isPairingKey(key)) {
      Object.assign(output, secureStringMetadata('pairing_code', value));
      continue;
    }

    if (isPasskeyPublicKey(key)) {
      Object.assign(output, secureStringMetadata('passkey_public_key', value));
      continue;
    }

    if (isPasskeySecretKey(key)) {
      Object.assign(output, secureStringMetadata('passkey_secret', value));
      continue;
    }

    const sanitizedValue = sanitizeValue(value, depth + 1);
    if (sanitizedValue !== undefined) {
      output[key] = sanitizedValue;
    }
  }

  return output;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth));
  }

  if (typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>, depth);
  }

  return String(value);
}

function isQrKey(key: string): boolean {
  return ['qr', 'qrcode', 'qr_code', 'qrCode'].includes(key);
}

function isPairingKey(key: string): boolean {
  return ['pairing_code', 'pairingCode'].includes(key);
}

function isPasskeyPublicKey(key: string): boolean {
  return ['passkey_public_key', 'passkeyPublicKey'].includes(key);
}

function isPasskeySecretKey(key: string): boolean {
  return [
    'passkey_response',
    'passkeyResponse',
    'passkey_confirmation_code',
    'passkeyConfirmationCode',
    'rawId',
    'clientDataJSON',
    'authenticatorData',
    'signature',
    'userHandle',
    'credential_id',
    'webauthn_assertion',
  ].includes(key);
}

function secureStringMetadata(
  prefix: 'qr' | 'pairing_code' | 'passkey_public_key' | 'passkey_secret',
  value: unknown
): Record<string, unknown> {
  const raw =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value);
  return {
    [`has_${prefix}`]: raw.length > 0,
    [`${prefix}_length`]: raw.length,
    [`${prefix}_sha256_12`]: raw ? hash12(raw) : undefined,
  };
}

function hash12(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function stabilizePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const stableKeys = [
    'seq',
    'event',
    'layer',
    'provider',
    'worker_id',
    'account_id',
    'worker_type_id',
    'worker_status_id',
    'status',
    'code',
    'session_ready',
    'can_send',
    'can_receive_runtime',
    'authenticated',
    'provider_state',
    'degraded_reason',
    'reason',
    'phone',
    'connection_attempt_id',
    'runtime_generation',
    'container_id',
    'offset',
    'timestamp',
  ];
  const output: Record<string, unknown> = {};

  for (const key of stableKeys) {
    if (payload[key] !== undefined) {
      output[key] = payload[key];
    }
  }

  for (const key of Object.keys(payload).sort()) {
    if (output[key] === undefined && payload[key] !== undefined) {
      output[key] = payload[key];
    }
  }

  return output;
}
