import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { OutboundWebhookEventType } from '@core/common/constants/outboundWebhookEvents';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { sanitizationMap } from '@core/common/functions/sanitizeValue';

export const OUTBOUND_WEBHOOK_PAYLOAD_VERSION = '1' as const;
export const OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES = 1024 * 1024;

type JsonPrimitive = string | number | boolean | null;
export type OutboundWebhookJsonValue =
  | JsonPrimitive
  | OutboundWebhookJsonValue[]
  | { [key: string]: OutboundWebhookJsonValue };

export interface OutboundWebhookAggregate {
  type: 'chat' | 'message' | 'contact' | 'webhook';
  id: string;
}

export interface OutboundWebhookActor {
  type: 'user' | 'customer' | 'automation' | 'system';
  id?: string | null;
}

export interface OutboundWebhookEnvelope {
  id: string;
  type: OutboundWebhookEventType;
  api_version: typeof OUTBOUND_WEBHOOK_PAYLOAD_VERSION;
  occurred_at: string;
  account_id: string;
  aggregate: OutboundWebhookAggregate;
  data: Record<string, OutboundWebhookJsonValue>;
  previous?: Record<string, OutboundWebhookJsonValue> | null;
  context?: {
    source: string;
    channel_ids: string[];
    actor?: OutboundWebhookActor | null;
  };
}

const OUTBOUND_WEBHOOK_CHANNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Freezes an event routing scope in a deterministic representation.
 * Channel identifiers are UUIDs, lower-cased, de-duplicated and sorted so the
 * signed envelope and the persisted routing scope can be compared exactly.
 */
export function normalizeOutboundWebhookChannelIds(
  channelIds: readonly string[]
): string[] {
  if (!Array.isArray(channelIds)) {
    throw new Error('outbound_webhook_event_channel_scope_required');
  }

  const normalized = new Set<string>();
  for (const channelId of channelIds) {
    if (typeof channelId !== 'string') {
      throw new Error('outbound_webhook_event_invalid_channel_scope');
    }
    const value = channelId.trim().toLowerCase();
    if (!OUTBOUND_WEBHOOK_CHANNEL_ID_PATTERN.test(value)) {
      throw new Error('outbound_webhook_event_invalid_channel_scope');
    }
    normalized.add(value);
  }

  const result = [...normalized].sort((first, second) =>
    first.localeCompare(second)
  );
  if (result.length === 0) {
    throw new Error('outbound_webhook_event_channel_scope_required');
  }
  return result;
}

const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:authorization|password|passwd|secret|token|cookie|credential|private_key|access_key|api_key|keyapi|ciphertext|base64|binary|raw|raw_payload|jwt|bearer)(?:$|_)/i;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PUBLIC_STRING_LENGTH = 256 * 1024;
const MAX_ARRAY_ITEMS = 2_000;
const MAX_OBJECT_KEYS = 2_000;
const MAX_OBJECT_DEPTH = 16;
const INLINE_BASE64_DATA_URL_PATTERN = /^data:[^,\r\n]{0,512};base64,/iu;
const EMBEDDED_MEDIA_BYTES_KEYS = new Set([
  'jpeg_thumbnail',
  'high_quality_thumbnail',
]);

function normalizeSensitiveKey(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .replace(/[^a-z\d]+/giu, '_')
    .toLowerCase();
}

function isSensitiveOrUnsafeKey(value: string): boolean {
  const normalized = normalizeSensitiveKey(value);
  return (
    UNSAFE_OBJECT_KEYS.has(value.toLowerCase()) ||
    SENSITIVE_KEY_PATTERN.test(normalized) ||
    EMBEDDED_MEDIA_BYTES_KEYS.has(normalized)
  );
}

function isBinaryValue(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) ||
    value instanceof ArrayBuffer
  );
}

function sanitizeString(value: string): string {
  if (value.length <= MAX_PUBLIC_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PUBLIC_STRING_LENGTH)}[truncated]`;
}

/**
 * Produces JSON-safe public data while removing credentials, provider payloads,
 * binary content, functions, and unbounded object graphs.
 */
export function sanitizeOutboundWebhookValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): OutboundWebhookJsonValue | undefined {
  if (value === null) return null;

  if (typeof value === 'string') {
    if (INLINE_BASE64_DATA_URL_PATTERN.test(value.trimStart())) {
      return undefined;
    }
    return sanitizeString(value);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function') {
    return undefined;
  }

  if (value instanceof Date) return value.toISOString();
  if (isBinaryValue(value) || depth >= MAX_OBJECT_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).flatMap((item) => {
      const sanitized = sanitizeOutboundWebhookValue(item, depth + 1, seen);
      return sanitized === undefined ? [] : [sanitized];
    });
  }

  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const result: Record<string, OutboundWebhookJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value).slice(
    0,
    MAX_OBJECT_KEYS
  )) {
    if (isSensitiveOrUnsafeKey(key)) continue;

    const sanitized = sanitizeOutboundWebhookValue(
      nestedValue,
      depth + 1,
      seen
    );
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  seen.delete(value);
  return result;
}

function sanitizeRecord(
  value: unknown
): Record<string, OutboundWebhookJsonValue> {
  const sanitized = sanitizeOutboundWebhookValue(value);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    return {};
  }

  return sanitized;
}

function isPrivateContactChangeKey(normalizedKey: string): boolean {
  const isContactPii = /^(?:email|phone|document)(?:_|$)/u.test(normalizedKey);
  return (
    isContactPii &&
    (/(?:^|_)c(?:$|_)/u.test(normalizedKey) ||
      /(?:encrypted|ciphertext|raw)/u.test(normalizedKey))
  );
}

function contactChangeTypeForKey(
  normalizedKey: string
): ETypeSanetize | undefined {
  if (/^email(?:_|$)/u.test(normalizedKey)) return ETypeSanetize.email;
  if (/^phone(?:_|$)/u.test(normalizedKey) && normalizedKey !== 'phone_ddi') {
    return ETypeSanetize.phone;
  }
  if (
    /^document(?:_|$)/u.test(normalizedKey) &&
    !/^document_(?:type|template|category)(?:_|$)/u.test(normalizedKey)
  ) {
    return ETypeSanetize.document;
  }
  return undefined;
}

function sanitizeContactChangeValue(
  value: OutboundWebhookJsonValue,
  inheritedType?: ETypeSanetize
): OutboundWebhookJsonValue {
  if (typeof value === 'string') {
    if (!inheritedType || !value || value.includes('*')) return value;
    return sanitizationMap[inheritedType](value) ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContactChangeValue(item, inheritedType));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, OutboundWebhookJsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeSensitiveKey(key);
      if (isPrivateContactChangeKey(normalizedKey)) continue;
      result[key] = sanitizeContactChangeValue(
        nested,
        contactChangeTypeForKey(normalizedKey) ?? inheritedType
      );
    }
    return result;
  }
  return value;
}

/**
 * Sanitizes contact mutation metadata without allowing raw contact fields to
 * bypass the explicit masking used by `data.contact`.
 */
export function sanitizeOutboundWebhookContactChanges(
  changes: unknown
): Record<string, OutboundWebhookJsonValue> {
  const sanitized = sanitizeRecord(changes);
  return sanitizeContactChangeValue(sanitized) as Record<
    string,
    OutboundWebhookJsonValue
  >;
}

export function serializePublicChat(
  chat: IChat
): Record<string, OutboundWebhookJsonValue> {
  return sanitizeRecord({
    chat_id: chat.chat_id,
    account: chat.account,
    worker: chat.worker,
    sector: chat.sector ?? null,
    user: chat.user ?? null,
    secondary_users: chat.secondary_users ?? [],
    contact: chat.contact ?? null,
    photo: chat.photo ?? null,
    name: chat.name,
    phone: chat.phone,
    status: chat.status,
    date: chat.date,
    started_at: chat.started_at ?? null,
    closed_at: chat.closed_at ?? null,
    protocol_ura: chat.protocol_ura ?? [],
    protocol_start: chat.protocol_start ?? [],
    protocol_transfer: chat.protocol_transfer ?? [],
    labels: chat.label ?? [],
    forward_to_output_chatbot: chat.forward_to_output_chatbot ?? null,
    official_window: chat.official_window ?? null,
    satisfaction_response: chat.satisfaction_response ?? null,
  });
}

export function serializePublicMessage(
  message: IChatMessage
): Record<string, OutboundWebhookJsonValue> {
  return sanitizeRecord({
    message_id: message.message_id,
    chat_id: message.chat_id,
    message_key: message.message_key ?? null,
    type_user: message.type_user,
    account: message.account,
    worker: message.worker,
    user: message.user ?? null,
    phone: message.phone,
    phone_ddi: message.phone_ddi ?? null,
    content: message.content ?? null,
    summary: message.summary,
    date: message.date,
    deleted: message.deleted ?? false,
    has_quoted: message.has_quoted ?? false,
    sent_from_platform: message.sent_from_platform ?? null,
  });
}

export function serializePublicContact(
  contact: Record<string, unknown>
): Record<string, OutboundWebhookJsonValue> {
  // Repository projections contain encrypted-at-rest values in `email`,
  // `phone` and `document`, alongside their explicitly public partial
  // counterparts. Prefer the partial field whenever the projection exposes
  // it; only use the unsuffixed field for already-public producer snapshots
  // (for example, a validated API request before persistence).
  const publicField = (partialKey: string, fallbackKey: string): unknown =>
    Object.prototype.hasOwnProperty.call(contact, partialKey)
      ? contact[partialKey]
      : contact[fallbackKey];
  const maskedPublicField = (
    partialKey: string,
    fallbackKey: string,
    type: ETypeSanetize
  ): unknown => {
    const value = publicField(partialKey, fallbackKey);
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.includes('*')
    ) {
      return value;
    }
    return sanitizationMap[type](value);
  };
  const nestedDocumentType =
    contact.contact_document_type &&
    typeof contact.contact_document_type === 'object' &&
    !Array.isArray(contact.contact_document_type)
      ? (contact.contact_document_type as Record<string, unknown>)
      : null;
  const optionalRelation = (key: string): unknown =>
    Object.prototype.hasOwnProperty.call(contact, key)
      ? contact[key]
      : undefined;

  const publicContact = {
    contact_id: contact.contact_id ?? contact.id ?? null,
    name: contact.name ?? null,
    last_name: contact.last_name ?? null,
    nickname: contact.nickname ?? null,
    email:
      maskedPublicField('email_partial', 'email', ETypeSanetize.email) ?? null,
    phone_ddi: contact.phone_ddi ?? null,
    phone:
      maskedPublicField('phone_partial', 'phone', ETypeSanetize.phone) ?? null,
    photo: contact.photo ?? null,
    birthday: contact.birthday ?? null,
    notes: contact.notes ?? null,
    document:
      maskedPublicField(
        'document_partial',
        'document',
        ETypeSanetize.document
      ) ?? null,
    contact_document_type_id:
      contact.contact_document_type_id ??
      nestedDocumentType?.contact_document_type_id ??
      null,
    responsible_attendant:
      contact.user ?? contact.responsible_attendant ?? null,
    responsible_attendant_id:
      contact.user_id ??
      (contact.user as Record<string, unknown> | null | undefined)?.user_id ??
      (contact.user as Record<string, unknown> | null | undefined)?.id ??
      null,
    label_templates: optionalRelation('label_templates'),
    channel_ids: optionalRelation('channel_ids'),
    contact_groups: Object.prototype.hasOwnProperty.call(
      contact,
      'contact_groups'
    )
      ? contact.contact_groups
      : optionalRelation('groups'),
    ignore: contact.ignore ?? null,
    is_valided: contact.is_valided ?? null,
    created_at: contact.created_at ?? null,
    updated_at: contact.updated_at ?? null,
    deleted_at: contact.deleted_at ?? null,
  };

  return sanitizeRecord(publicContact);
}

export function assertOutboundWebhookPayloadSize(
  envelope: OutboundWebhookEnvelope
): void {
  const payloadBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (payloadBytes > OUTBOUND_WEBHOOK_MAX_PAYLOAD_BYTES) {
    throw new Error('outbound_webhook_payload_too_large');
  }
}

export function buildOutboundWebhookEnvelope(input: {
  id: string;
  type: OutboundWebhookEventType;
  occurredAt?: Date | string;
  accountId: string;
  aggregate: OutboundWebhookAggregate;
  data: Record<string, OutboundWebhookJsonValue>;
  previous?: Record<string, OutboundWebhookJsonValue> | null;
  source: string;
  channelIds: readonly string[];
  actor?: OutboundWebhookActor | null;
}): OutboundWebhookEnvelope {
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());

  const envelope: OutboundWebhookEnvelope = {
    id: input.id,
    type: input.type,
    api_version: OUTBOUND_WEBHOOK_PAYLOAD_VERSION,
    occurred_at: occurredAt,
    account_id: input.accountId,
    aggregate: input.aggregate,
    // Sanitize again at the contract boundary. Individual serializers already
    // minimize their snapshots, but this prevents a future producer from
    // persisting credentials or non-JSON values by mistake.
    data: sanitizeRecord(input.data),
    previous:
      input.previous === null || input.previous === undefined
        ? null
        : sanitizeRecord(input.previous),
    context: {
      source: input.source,
      channel_ids: normalizeOutboundWebhookChannelIds(input.channelIds),
      actor: input.actor ?? null,
    },
  };

  assertOutboundWebhookPayloadSize(envelope);
  return envelope;
}
