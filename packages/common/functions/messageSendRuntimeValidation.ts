import { Value } from '@sinclair/typebox/value';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import {
  contactSchema,
  contentSchema,
  messageKeySchema,
} from '@core/schema/chat/listMessageChats/response.schema';

type RuntimeRecord = Record<string, unknown>;
const SUPPORTED_MESSAGE_TYPES = new Set<string>(Object.values(EMessageType));

function isRecord(value: unknown): value is RuntimeRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringOrNullish(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasRuntimeSafeMessageKey(value: unknown): boolean {
  return (
    isRecord(value) &&
    Value.Check(messageKeySchema, value) &&
    (isNonEmptyString(value.remote_jid) ||
      isNonEmptyString(value.remote_jid_alt))
  );
}

function hasRuntimeSafeQuotedMessage(content: RuntimeRecord): boolean {
  const quoted = content.quoted;
  if (quoted === undefined || quoted === null) {
    return true;
  }
  if (!isRecord(quoted) || !isRecord(quoted.key)) {
    return false;
  }
  if (
    !isNonEmptyString(quoted.key.id) ||
    (quoted.type !== undefined &&
      quoted.type !== null &&
      !SUPPORTED_MESSAGE_TYPES.has(String(quoted.type)))
  ) {
    return false;
  }
  if (quoted.type === EMessageType.contacts) {
    const contacts = quoted.contacts;
    return (
      Array.isArray(contacts) &&
      contacts.length > 0 &&
      contacts.every((contact) => Value.Check(contactSchema, contact))
    );
  }
  return true;
}

function hasRequiredContentForType(content: RuntimeRecord): boolean {
  switch (content.type) {
    case EMessageType.text:
    case EMessageType.system:
      return isNonEmptyString(content.message);
    case EMessageType.image:
      return isRecord(content.image) && isNonEmptyString(content.image.url);
    case EMessageType.video:
    case EMessageType.video_note:
      return isRecord(content.video) && isNonEmptyString(content.video.url);
    case EMessageType.audio:
      return isRecord(content.audio) && isNonEmptyString(content.audio.url);
    case EMessageType.document:
      return (
        isRecord(content.document) && isNonEmptyString(content.document.url)
      );
    case EMessageType.sticker:
      return isRecord(content.sticker) && isNonEmptyString(content.sticker.url);
    case EMessageType.location:
      return (
        isRecord(content.location) &&
        isFiniteNumber(content.location.latitude) &&
        isFiniteNumber(content.location.longitude)
      );
    case EMessageType.contact_card:
      return isRecord(content.contact);
    case EMessageType.contacts:
      return Array.isArray(content.contacts) && content.contacts.length > 0;
    case EMessageType.react:
      return Array.isArray(content.reactions);
    default:
      return true;
  }
}

/**
 * Kafka payloads do not retain their TypeScript types at runtime. This guard
 * deliberately runs before a runtime fence, Redis claim, or provider SDK call
 * so malformed records are terminal input errors instead of retryable worker
 * outages (or deterministic TypeErrors that can poison a partition).
 */
export function isRuntimeSafeChatMessagePayload(
  value: unknown
): value is IChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  const account = value.account;
  const worker = value.worker;
  const content = value.content;
  if (
    !isNonEmptyString(value.message_id) ||
    !isNonEmptyString(value.chat_id) ||
    !isRecord(account) ||
    !isNonEmptyString(account.id) ||
    (worker !== undefined &&
      worker !== null &&
      (!isRecord(worker) || !isNonEmptyString(worker.id))) ||
    !hasRuntimeSafeMessageKey(value.message_key) ||
    !isRecord(content) ||
    !SUPPORTED_MESSAGE_TYPES.has(String(content.type)) ||
    !Value.Check(contentSchema, content) ||
    !hasRuntimeSafeQuotedMessage(content) ||
    !hasRequiredContentForType(content)
  ) {
    return false;
  }

  if (
    !isStringOrNullish(value.phone) ||
    !isStringOrNullish(value.phone_ddi) ||
    !isStringOrNullish(value.hash) ||
    (value.send_delay_ms !== undefined &&
      value.send_delay_ms !== null &&
      !isFiniteNumber(value.send_delay_ms))
  ) {
    return false;
  }

  const forward = content.forward;
  if (forward !== undefined && forward !== null) {
    if (
      !isRecord(forward) ||
      !isNonEmptyString(forward.source_message_id) ||
      !isNonEmptyString(forward.source_chat_id) ||
      !isNonEmptyString(forward.source_type) ||
      !SUPPORTED_MESSAGE_TYPES.has(forward.source_type)
    ) {
      return false;
    }
    if (
      forward.source_message_key !== undefined &&
      forward.source_message_key !== null &&
      !Value.Check(messageKeySchema, forward.source_message_key)
    ) {
      return false;
    }
  }

  return true;
}

export function isRuntimeSafeProfileStatusDeletePayload(
  value: unknown
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.worker_id) &&
    isNonEmptyString(value.account_id) &&
    isNonEmptyString(value.worker_profile_status_id) &&
    isNonEmptyString(value.external_id) &&
    (value.statusJidList === undefined ||
      (Array.isArray(value.statusJidList) &&
        value.statusJidList.every(isNonEmptyString)))
  );
}

export function isRuntimeSafeProfileStatusPayload(value: unknown): boolean {
  if (!isRecord(value) || 'external_id' in value) {
    return false;
  }
  return (
    isNonEmptyString(value.worker_id) &&
    isNonEmptyString(value.account_id) &&
    isNonEmptyString(value.worker_profile_status_id) &&
    isNonEmptyString(value.worker_profile_status_type_id) &&
    isNonEmptyString(value.value) &&
    typeof value.is_permanent === 'boolean' &&
    (value.statusJidList === undefined ||
      (Array.isArray(value.statusJidList) &&
        value.statusJidList.every(isNonEmptyString)))
  );
}

export function isRuntimeSafeProfileInfoPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const hasProfileMutation =
    Object.hasOwn(value, 'name') ||
    Object.hasOwn(value, 'message') ||
    Object.hasOwn(value, 'photo');
  return (
    isNonEmptyString(value.worker_id) &&
    isNonEmptyString(value.account_id) &&
    hasProfileMutation &&
    isStringOrNullish(value.name) &&
    isStringOrNullish(value.message) &&
    isStringOrNullish(value.photo)
  );
}
