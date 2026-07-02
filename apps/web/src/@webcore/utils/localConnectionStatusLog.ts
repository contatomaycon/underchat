const LOG_PREFIX = '[LOCAL_CONNECTION_STATUS]';

export type LocalConnectionStatusLogContext = Record<string, unknown>;

let localSequence = 0;

export const isLocalConnectionStatusLogEnabled = (): boolean => {
  const env = String(
    import.meta.env.APP_ENVIRONMENT ??
      import.meta.env.VITE_APP_ENVIRONMENT ??
      ''
  ).toUpperCase();

  if (env === 'LOCAL') {
    return true;
  }

  try {
    return (
      globalThis.localStorage?.getItem('underchat_connection_status_log') ===
      '1'
    );
  } catch {
    return false;
  }
};

export const logLocalConnectionStatus = (
  event: string,
  context: LocalConnectionStatusLogContext = {}
): void => {
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
    layer: sanitizedContext.layer ?? 'web',
    timestamp: new Date().toISOString(),
    ...sanitizedContext,
  });

  console.log(LOG_PREFIX, JSON.stringify(payload));
};

const sanitizeObject = (
  input: Record<string, unknown>,
  depth: number
): Record<string, unknown> => {
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
};

const sanitizeValue = (value: unknown, depth: number): unknown => {
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
};

const isQrKey = (key: string): boolean =>
  ['qr', 'qrcode', 'qr_code', 'qrCode'].includes(key);

const isPairingKey = (key: string): boolean =>
  ['pairing_code', 'pairingCode'].includes(key);

const isPasskeyPublicKey = (key: string): boolean =>
  ['passkey_public_key', 'passkeyPublicKey'].includes(key);

const isPasskeySecretKey = (key: string): boolean =>
  [
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

const secureStringMetadata = (
  prefix: 'qr' | 'pairing_code' | 'passkey_public_key' | 'passkey_secret',
  value: unknown
): Record<string, unknown> => {
  const raw =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value);
  return {
    [`has_${prefix}`]: raw.length > 0,
    [`${prefix}_length`]: raw.length,
    [`${prefix}_hash`]: raw ? hashString(raw) : undefined,
  };
};

const hashString = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 12);
};

const stabilizePayload = (
  payload: Record<string, unknown>
): Record<string, unknown> => {
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
};
