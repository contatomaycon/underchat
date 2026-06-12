const TRACE_HEADER = 'x-connection-lifecycle-debug-trace-id';
const localTraceSequences = new Map<string, number>();
let localSequence = 0;

export interface ConnectionLifecycleDebugContext {
  trace_id?: string;
  layer?: string;
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  lifecycle_operation_id?: string;
  connection_attempt_id?: string;
  runtime_generation?: number | string;
  status?: string;
  code?: string | number;
  reason?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export const isConnectionLifecycleDebugEnabled = (): boolean =>
  import.meta.env.VITE_CONNECTION_LIFECYCLE_DEBUG_ENABLED === 'true';

export const createConnectionLifecycleDebugTraceId = (
  prefix = 'web'
): string => {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
};

export const connectionLifecycleDebugHeaders = (
  traceId?: string
): Record<string, string> | undefined => {
  if (!isConnectionLifecycleDebugEnabled() || !traceId) {
    return undefined;
  }

  return { [TRACE_HEADER]: traceId };
};

export const logConnectionLifecycleDebug = (
  event: string,
  context: ConnectionLifecycleDebugContext = {}
): void => {
  if (!isConnectionLifecycleDebugEnabled()) {
    return;
  }

  const traceId = context.trace_id || 'web-no-trace';
  localSequence += 1;
  const traceSequence = (localTraceSequences.get(traceId) ?? 0) + 1;
  localTraceSequences.set(traceId, traceSequence);
  const sanitizedContext = sanitizeContext(context);
  if (sanitizedContext.event !== undefined) {
    sanitizedContext.source_event = sanitizedContext.event;
    delete sanitizedContext.event;
  }

  const payload = stabilizePayload({
    seq: localSequence,
    trace_seq: traceSequence,
    trace_id: traceId,
    event,
    layer: context.layer ?? 'web',
    timestamp: new Date().toISOString(),
    ...sanitizedContext,
  });

  console.log('[connection-lifecycle-debug]', JSON.stringify(payload));
};

const sanitizeContext = (
  context: ConnectionLifecycleDebugContext
): Record<string, unknown> => {
  const sanitized = sanitizeObject(context, 0);
  delete sanitized.trace_id;
  return sanitized;
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
      Object.assign(output, qrMetadata(value));
      continue;
    }

    if (isPairingKey(key)) {
      Object.assign(output, pairingMetadata(value));
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
  if (value === undefined || value === null) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
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

const qrMetadata = (value: unknown): Record<string, unknown> => {
  const raw = typeof value === 'string' ? value : '';
  return {
    has_qr: raw.length > 0,
    qr_length: raw.length,
    qr_hash: raw ? hashString(raw) : undefined,
  };
};

const pairingMetadata = (value: unknown): Record<string, unknown> => {
  const raw = typeof value === 'string' ? value : '';
  return {
    has_pairing_code: raw.length > 0,
    pairing_code_length: raw.length,
    pairing_code_hash: raw ? hashString(raw) : undefined,
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
    'trace_seq',
    'trace_id',
    'event',
    'layer',
    'worker_id',
    'account_id',
    'worker_type_id',
    'lifecycle_operation_id',
    'connection_attempt_id',
    'runtime_generation',
    'status',
    'code',
    'reason',
    'duration_ms',
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
