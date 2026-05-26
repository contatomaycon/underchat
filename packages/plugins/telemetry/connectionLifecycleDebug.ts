import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { Metadata } from '@grpc/grpc-js';
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';
import { logger } from './logger';

type PrimitiveLogValue = string | number | boolean;

export type ConnectionLifecycleSourceProvider =
  | 'baileys'
  | 'wwebjs'
  | 'whatsmeow'
  | 'manager'
  | 'balancer'
  | 'service';

export interface ConnectionLifecycleContext {
  connection_lifecycle_id: string;
  account_id?: string;
  worker_id?: string;
  channel_id?: string;
  worker_type?: string;
  source_provider?: ConnectionLifecycleSourceProvider | string;
  connection_type?: string;
  connection_action?: string;
}

export interface ConnectionLifecycleEvent extends Partial<ConnectionLifecycleContext> {
  stage: string;
  decision?: string;
  outcome?: string;
  reason?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  status?: string | null;
  code?: string | number | null;
  worker_status_id?: string | null;
  attempt?: number;
  max_attempts?: number;
  grpc_method?: string;
  grpc_address?: string;
  deadline_ms?: number;
  value?: unknown;
  raw_payload?: unknown;
  qrcode?: unknown;
  qr_code?: unknown;
  qr?: unknown;
  pairing_code?: unknown;
  [key: string]: unknown;
}

const lifecycleStorage = new AsyncLocalStorage<ConnectionLifecycleContext>();
const DEBUG_INDEX = 'connection_lifecycle';
const GRPC_CONNECTION_LIFECYCLE_ID_HEADER = 'x-connection-lifecycle-id';
const DEFAULT_VALUE_LIMIT = 500;
const DEFAULT_RAW_LIMIT = 4000;
const lifecycleTracer = trace.getTracer('connection-lifecycle');

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isConnectionLifecycleDebugEnabled(): boolean {
  return process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED === 'true';
}

export function getConnectionLifecycleContext():
  | ConnectionLifecycleContext
  | undefined {
  return lifecycleStorage.getStore();
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildStableConnectionId(parts: Array<unknown>): string {
  const normalized = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .join(':');
  return createHash('sha1').update(normalized).digest('hex');
}

function hashSensitiveValue(value: unknown): {
  hash?: string;
  length?: number;
} {
  if (value === null || value === undefined) {
    return {};
  }

  const normalized =
    typeof value === 'string'
      ? value
      : (JSON.stringify(value) ?? String(value));

  return {
    hash: createHash('sha256').update(normalized).digest('hex').slice(0, 16),
    length: normalized.length,
  };
}

export function buildConnectionLifecycleContext(
  input: Partial<ConnectionLifecycleContext> = {}
): ConnectionLifecycleContext {
  const active = getConnectionLifecycleContext();
  const accountId = toNonEmptyString(input.account_id ?? active?.account_id);
  const workerId = toNonEmptyString(input.worker_id ?? active?.worker_id);
  const sourceProvider = toNonEmptyString(
    input.source_provider ?? active?.source_provider
  );
  const connectionType = toNonEmptyString(
    input.connection_type ?? active?.connection_type
  );
  const connectionAction = toNonEmptyString(
    input.connection_action ?? active?.connection_action
  );
  const lifecycleId =
    toNonEmptyString(input.connection_lifecycle_id) ??
    active?.connection_lifecycle_id ??
    buildStableConnectionId([
      randomUUID(),
      accountId,
      workerId,
      sourceProvider,
      connectionType,
      connectionAction,
    ]);

  return {
    connection_lifecycle_id: lifecycleId,
    account_id: accountId,
    worker_id: workerId,
    channel_id:
      toNonEmptyString(input.channel_id ?? active?.channel_id) ?? workerId,
    worker_type: toNonEmptyString(input.worker_type ?? active?.worker_type),
    source_provider: sourceProvider,
    connection_type: connectionType,
    connection_action: connectionAction,
  };
}

export function runWithConnectionLifecycleContext<T>(
  contextData: ConnectionLifecycleContext,
  callback: () => Promise<T>
): Promise<T>;
export function runWithConnectionLifecycleContext<T>(
  contextData: ConnectionLifecycleContext,
  callback: () => T
): T;
export function runWithConnectionLifecycleContext<T>(
  contextData: ConnectionLifecycleContext,
  callback: () => T | Promise<T>
): T | Promise<T> {
  const runCallback = () => lifecycleStorage.run(contextData, callback);
  if (!isConnectionLifecycleDebugEnabled()) {
    return runCallback();
  }

  return lifecycleTracer.startActiveSpan(
    `connection_lifecycle.${contextData.source_provider ?? 'unknown'}`,
    {
      attributes: Object.fromEntries(
        Object.entries(contextData).filter(
          ([, value]) =>
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        )
      ),
    },
    (span) => {
      try {
        const result = runCallback();

        if (result instanceof Promise) {
          return result
            .then((resolved) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return resolved;
            })
            .catch((error) => {
              const normalizedError =
                error instanceof Error ? error : new Error(String(error));
              span.recordException(normalizedError);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: normalizedError.message,
              });
              span.end();
              throw error;
            });
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        span.recordException(normalizedError);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalizedError.message,
        });
        span.end();
        throw error;
      }
    }
  );
}

function sourceLocation(): {
  source_file?: string;
  source_line?: number;
  source_function?: string;
} {
  const stack = new Error().stack?.split('\n').slice(2) ?? [];
  const frame = stack.find(
    (line) =>
      !line.includes('connectionLifecycleDebug') &&
      !line.includes('.logConnectionEvent') &&
      !line.includes('node:internal')
  );

  if (!frame) {
    return {};
  }

  const withFunction = frame.match(/\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)/u);
  if (withFunction) {
    return {
      source_function: withFunction[1],
      source_file: withFunction[2],
      source_line: Number.parseInt(withFunction[3], 10),
    };
  }

  const anonymous = frame.match(/\s*at\s+(.+):(\d+):(\d+)/u);
  if (anonymous) {
    return {
      source_file: anonymous[1],
      source_line: Number.parseInt(anonymous[2], 10),
    };
  }

  return {};
}

function truncateValue(
  value: unknown,
  limit: number
): { value?: string; truncated: boolean } {
  if (value === null || value === undefined) {
    return { truncated: false };
  }

  let normalized: string;
  if (typeof value === 'string') {
    normalized = value;
  } else {
    try {
      normalized = JSON.stringify(value);
    } catch {
      normalized = String(value);
    }
  }

  if (normalized.length <= limit) {
    return { value: normalized, truncated: false };
  }

  return {
    value: `${normalized.slice(0, limit)}...<truncated>`,
    truncated: true,
  };
}

function sanitizeRawPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRawPayload(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (['qrcode', 'qr_code', 'qr', 'pairing_code'].includes(key)) {
      const sensitive = hashSensitiveValue(item);
      sanitized[`has_${key}`] = item !== null && item !== undefined;
      sanitized[`${key}_hash`] = sensitive.hash;
      sanitized[`${key}_length`] = sensitive.length;
      continue;
    }
    sanitized[key] = sanitizeRawPayload(item);
  }

  return sanitized;
}

function addSensitiveMetadata(
  payload: Record<string, PrimitiveLogValue>,
  event: ConnectionLifecycleEvent
): void {
  const qrValue = event.qrcode ?? event.qr_code ?? event.qr;
  if (qrValue !== null && qrValue !== undefined) {
    const sensitive = hashSensitiveValue(qrValue);
    payload.has_qr = true;
    if (sensitive.hash) payload.qr_hash = sensitive.hash;
    if (sensitive.length !== undefined) payload.qr_length = sensitive.length;
  }

  if (event.pairing_code !== null && event.pairing_code !== undefined) {
    const sensitive = hashSensitiveValue(event.pairing_code);
    payload.has_pairing_code = true;
    if (sensitive.hash) payload.pairing_code_hash = sensitive.hash;
    if (sensitive.length !== undefined) {
      payload.pairing_code_length = sensitive.length;
    }
  }
}

function normalizeEventPayload(
  event: ConnectionLifecycleEvent
): Record<string, PrimitiveLogValue> {
  const valueLimit = readPositiveIntEnv(
    'CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT',
    DEFAULT_VALUE_LIMIT
  );
  const rawLimit = readPositiveIntEnv(
    'CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT',
    DEFAULT_RAW_LIMIT
  );
  const active = getConnectionLifecycleContext();
  const location = sourceLocation();
  const contextData = buildConnectionLifecycleContext({
    ...(active ?? {}),
    ...event,
  });
  const payload: Record<string, PrimitiveLogValue> = {
    debug_index: DEBUG_INDEX,
    log_type: DEBUG_INDEX,
    stage: event.stage,
    connection_lifecycle_id: contextData.connection_lifecycle_id,
  };

  if (location.source_file) {
    payload.source_file = location.source_file;
  }
  if (location.source_line) {
    payload.source_line = location.source_line;
  }
  if (location.source_function) {
    payload.source_function = location.source_function;
  }

  const merged: Record<string, unknown> = {
    ...contextData,
    ...event,
  };
  delete merged.level;
  delete merged.message;
  delete merged.value;
  delete merged.raw_payload;
  delete merged.qrcode;
  delete merged.qr_code;
  delete merged.qr;
  delete merged.pairing_code;

  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      payload[key] = value;
    }
  }

  addSensitiveMetadata(payload, event);

  const value = truncateValue(event.value, valueLimit);
  if (value.value !== undefined) {
    payload.value = value.value;
    payload.value_truncated = value.truncated;
  }

  const rawPayload = truncateValue(
    sanitizeRawPayload(event.raw_payload),
    rawLimit
  );
  if (rawPayload.value !== undefined) {
    payload.raw_payload = rawPayload.value;
    payload.raw_truncated = rawPayload.truncated;
  }

  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (spanContext) {
    payload.trace_id = spanContext.traceId;
    payload.span_id = spanContext.spanId;
  }

  return payload;
}

export function recordConnectionLifecycle(
  event: ConnectionLifecycleEvent
): void {
  if (!isConnectionLifecycleDebugEnabled()) {
    return;
  }

  const level = event.level ?? 'info';
  logger[level](
    normalizeEventPayload(event),
    event.message ?? 'Connection lifecycle event'
  );
}

function metadataToCarrier(metadata?: Metadata): Record<string, string> {
  const carrier: Record<string, string> = {};
  if (!metadata) {
    return carrier;
  }

  for (const [key, value] of Object.entries(metadata.getMap())) {
    if (value === null || value === undefined) {
      continue;
    }
    carrier[key] = Buffer.isBuffer(value)
      ? value.toString('utf8')
      : String(value);
  }
  return carrier;
}

function setCarrierOnMetadata(
  metadata: Metadata,
  carrier: Record<string, string>
): Metadata {
  for (const [key, value] of Object.entries(carrier)) {
    metadata.set(key, value);
  }
  return metadata;
}

export function injectGrpcConnectionMetadata(
  metadata: Metadata = new Metadata(),
  contextData?: ConnectionLifecycleContext
): Metadata {
  const active = getConnectionLifecycleContext();
  const lifecycle = contextData ?? active;
  const carrier = metadataToCarrier(metadata);
  propagation.inject(context.active(), carrier);
  if (lifecycle?.connection_lifecycle_id) {
    carrier[GRPC_CONNECTION_LIFECYCLE_ID_HEADER] =
      lifecycle.connection_lifecycle_id;
  }
  return setCarrierOnMetadata(metadata, carrier);
}

export function connectionLifecycleIdFromGrpcMetadata(
  metadata?: Metadata
): string | undefined {
  const direct = metadata?.get(GRPC_CONNECTION_LIFECYCLE_ID_HEADER)?.[0];
  if (direct === null || direct === undefined) {
    return undefined;
  }

  return Buffer.isBuffer(direct) ? direct.toString('utf8') : String(direct);
}

export function runWithGrpcConnectionContext<T>(
  metadata: Metadata | undefined,
  contextData: ConnectionLifecycleContext,
  callback: () => Promise<T>
): Promise<T>;
export function runWithGrpcConnectionContext<T>(
  metadata: Metadata | undefined,
  contextData: ConnectionLifecycleContext,
  callback: () => T
): T;
export function runWithGrpcConnectionContext<T>(
  metadata: Metadata | undefined,
  contextData: ConnectionLifecycleContext,
  callback: () => T | Promise<T>
): T | Promise<T> {
  const carrier = metadataToCarrier(metadata);
  const extracted = propagation.extract(context.active(), carrier);
  const lifecycle = buildConnectionLifecycleContext({
    ...contextData,
    connection_lifecycle_id:
      connectionLifecycleIdFromGrpcMetadata(metadata) ??
      contextData.connection_lifecycle_id,
  });

  return context.with(extracted, () =>
    runWithConnectionLifecycleContext(lifecycle, callback)
  );
}

export function currentConnectionTraceIds():
  | { trace_id: string; span_id: string }
  | undefined {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext) {
    return undefined;
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}
