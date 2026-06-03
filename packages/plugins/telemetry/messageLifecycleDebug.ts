import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { MessageHeader } from 'node-rdkafka';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { logger } from './logger';

export type MessageLifecycleSourceProvider =
  | 'baileys'
  | 'wwebjs'
  | 'whatsmeow'
  | 'webhook';

type PrimitiveLogValue = string | number | boolean;

export interface MessageLifecycleContext {
  message_lifecycle_id: string;
  account_id?: string;
  worker_id?: string;
  channel_id?: string;
  source_provider?: MessageLifecycleSourceProvider | string;
  message_key_id?: string;
  phone?: string;
  jid?: string;
  lid?: string;
  remote_jid?: string;
  remote_jid_alt?: string;
}

export interface MessageLifecycleEvent extends Partial<MessageLifecycleContext> {
  stage: string;
  decision?: string;
  outcome?: string;
  reason?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  message_text?: unknown;
  raw_payload?: unknown;
  [key: string]: unknown;
}

const lifecycleStorage = new AsyncLocalStorage<MessageLifecycleContext>();
const DEBUG_INDEX = 'message_lifecycle';
const DEFAULT_BODY_LIMIT = 500;
const DEFAULT_RAW_LIMIT = 4000;
const lifecycleTracer = trace.getTracer('message-lifecycle');
const EXCEPTION_OUTCOMES = new Set([
  'error',
  'failed',
  'partial_error',
  'timeout',
  'dlq',
  'discarded',
  'dropped',
  'skipped',
  'ignored',
  'ignore_totally',
  'ignore_automation',
  'retrying',
  'closed',
  'message_creation_skipped',
  'chat_saved_without_message',
]);
const ERROR_OUTCOMES = new Set([
  'error',
  'failed',
  'partial_error',
  'timeout',
  'dlq',
]);
const ERROR_FIELD_KEYS = [
  'error',
  'err',
  'exception',
  'stack',
  'error_message',
];
const SPAN_ATTRIBUTE_OMIT_KEYS = new Set([
  'message',
  'message_text',
  'raw_payload',
]);

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isMessageLifecycleDebugEnabled(): boolean {
  return process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED === 'true';
}

function isOutboundLifecycleSuccessEnabled(): boolean {
  return process.env.MESSAGE_LIFECYCLE_OUTBOUND_SUCCESS_ENABLED !== 'false';
}

export function getMessageLifecycleContext():
  | MessageLifecycleContext
  | undefined {
  return lifecycleStorage.getStore();
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeJid(value: unknown): string | undefined {
  const raw = toNonEmptyString(value);
  if (!raw) return undefined;
  return raw.toLowerCase();
}

function jidUser(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const user = value.split('@')[0]?.replace(/\D/g, '');
  return user && user.length >= 8 ? user : undefined;
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

function buildStableLifecycleId(parts: Array<unknown>): string {
  const source = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .join(':');
  return createHash('sha1').update(source).digest('hex');
}

export function buildMessageLifecycleContext(
  data: Partial<IUpsertMessage> | undefined,
  sourceProvider?: MessageLifecycleSourceProvider | string
): MessageLifecycleContext {
  const key = data?.message?.key;
  const remoteJid = normalizeJid(key?.remoteJid);
  const remoteJidAlt = normalizeJid(key?.remoteJidAlt);
  const participant = normalizeJid(key?.participant);
  const participantAlt = normalizeJid(key?.participantAlt);
  const lid =
    [remoteJid, remoteJidAlt, participant, participantAlt].find((candidate) =>
      candidate?.endsWith('@lid')
    ) ?? undefined;
  const jid =
    [remoteJid, remoteJidAlt, participant, participantAlt].find(
      (candidate) => candidate && !candidate.endsWith('@lid')
    ) ?? undefined;

  const messageKeyId = toNonEmptyString(key?.id);
  const accountId = toNonEmptyString(data?.account_id);
  const workerId = toNonEmptyString(data?.worker_id);
  const provider = sourceProvider ?? data?.source_provider;

  return {
    message_lifecycle_id: buildStableLifecycleId([
      accountId,
      workerId,
      remoteJid,
      remoteJidAlt,
      key?.fromMe === true ? '1' : '0',
      messageKeyId,
    ]),
    account_id: accountId,
    worker_id: workerId,
    channel_id: workerId,
    source_provider: provider,
    message_key_id: messageKeyId,
    phone: jidUser(jid ?? remoteJid ?? remoteJidAlt),
    jid,
    lid,
    remote_jid: remoteJid,
    remote_jid_alt: remoteJidAlt,
  };
}

export function runWithMessageLifecycleContext<T>(
  contextData: MessageLifecycleContext,
  callback: () => T | Promise<T>
): T | Promise<T> {
  return lifecycleStorage.run(contextData, callback);
}

function sourceLocation(): {
  source_file?: string;
  source_line?: number;
  source_function?: string;
} {
  const stack = new Error().stack?.split('\n').slice(2) ?? [];
  const frame = stack.find(
    (line) =>
      !line.includes('messageLifecycleDebug') &&
      !line.includes('.logLifecycle') &&
      !line.includes('.logLifecycleForMessage') &&
      !line.includes('.logLifecycleForUpsert') &&
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

function normalizeEventPayload(
  event: MessageLifecycleEvent
): Record<string, PrimitiveLogValue> {
  const bodyLimit = readPositiveIntEnv(
    'MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT',
    DEFAULT_BODY_LIMIT
  );
  const rawLimit = readPositiveIntEnv(
    'MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT',
    DEFAULT_RAW_LIMIT
  );
  const active = getMessageLifecycleContext();
  const location = sourceLocation();
  const payload: Record<string, PrimitiveLogValue> = {
    debug_index: DEBUG_INDEX,
    log_type: DEBUG_INDEX,
    stage: event.stage,
    message_lifecycle_id:
      event.message_lifecycle_id ?? active?.message_lifecycle_id ?? 'unknown',
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
    ...(active ?? {}),
    ...event,
  };
  delete merged.level;
  delete merged.message;
  delete merged.message_text;
  delete merged.raw_payload;

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

  const messageText = truncateValue(event.message_text, bodyLimit);
  if (messageText.value !== undefined) {
    payload.message_text = messageText.value;
    payload.message_truncated = messageText.truncated;
  }

  const rawPayload = truncateValue(event.raw_payload, rawLimit);
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

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function eventHasErrorField(event: MessageLifecycleEvent): boolean {
  return ERROR_FIELD_KEYS.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(event, key) &&
      hasMeaningfulValue(event[key])
  );
}

function shouldRecordLifecycleEvent(event: MessageLifecycleEvent): boolean {
  const level = normalizeToken(event.level);
  if (level === 'warn' || level === 'error') return true;

  const outcome = normalizeToken(event.outcome);
  if (outcome && EXCEPTION_OUTCOMES.has(outcome)) return true;

  if (
    isOutboundLifecycleSuccessEnabled() &&
    (event.stage.startsWith('service.outgoing.') ||
      event.stage.startsWith('whatsmeow.outgoing.'))
  ) {
    return true;
  }

  return eventHasErrorField(event);
}

function isErrorLifecycleEvent(event: MessageLifecycleEvent): boolean {
  if (normalizeToken(event.level) === 'error') return true;

  const outcome = normalizeToken(event.outcome);
  if (outcome && ERROR_OUTCOMES.has(outcome)) return true;

  return eventHasErrorField(event);
}

function errorFromLifecycleEvent(event: MessageLifecycleEvent): Error {
  const value = ERROR_FIELD_KEYS.map((key) => event[key]).find(
    hasMeaningfulValue
  );
  if (value instanceof Error) return value;

  const message =
    toNonEmptyString(value) ??
    toNonEmptyString(event.reason) ??
    `${event.stage}:${event.outcome ?? 'exception'}`;
  return new Error(message);
}

function spanAttributes(
  payload: Record<string, PrimitiveLogValue>
): Record<string, PrimitiveLogValue> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !SPAN_ATTRIBUTE_OMIT_KEYS.has(key)
    )
  );
}

function recordLifecycleExceptionSpan(
  payload: Record<string, PrimitiveLogValue>,
  event: MessageLifecycleEvent
): void {
  const span = lifecycleTracer.startSpan(
    `message_lifecycle.exception.${event.stage}`,
    { attributes: spanAttributes(payload) }
  );
  const spanContext = span.spanContext();
  payload.trace_id = spanContext.traceId;
  payload.span_id = spanContext.spanId;

  if (isErrorLifecycleEvent(event)) {
    const error = errorFromLifecycleEvent(event);
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  span.end();
}

export function recordMessageLifecycle(event: MessageLifecycleEvent): void {
  if (!isMessageLifecycleDebugEnabled() || !shouldRecordLifecycleEvent(event)) {
    return;
  }

  const level = event.level ?? 'info';
  const payload = normalizeEventPayload(event);
  recordLifecycleExceptionSpan(payload, event);
  logger[level](payload, event.message ?? 'Message lifecycle event');
}

function headersToCarrier(headers?: MessageHeader[]): Record<string, string> {
  const carrier: Record<string, string> = {};
  for (const header of headers ?? []) {
    for (const [key, value] of Object.entries(header)) {
      if (value === null || value === undefined) {
        continue;
      }
      carrier[key] = Buffer.isBuffer(value)
        ? value.toString('utf8')
        : String(value);
    }
  }
  return carrier;
}

function carrierToHeaders(carrier: Record<string, string>): MessageHeader[] {
  return Object.entries(carrier).map(([key, value]) => ({ [key]: value }));
}

export function injectKafkaTraceHeaders(
  headers: MessageHeader[] = []
): MessageHeader[] {
  const carrier = headersToCarrier(headers);
  propagation.inject(context.active(), carrier);
  return carrierToHeaders(carrier);
}

export function runWithKafkaTraceContext<T>(
  headers: MessageHeader[] | undefined,
  callback: () => T | Promise<T>
): T | Promise<T> {
  const carrier = headersToCarrier(headers);
  const extracted = propagation.extract(context.active(), carrier);
  return context.with(extracted, callback);
}

export function currentTraceIds():
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
