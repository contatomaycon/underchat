import { createHash } from 'node:crypto';
import { EMessageType } from '../enums/EMessageType';
import {
  IUpsertMessage,
  IUpsertMessageKey,
} from '../interfaces/IUpsertMessage';
import { parseSerializedMessageId } from './parseSerializedMessageId';

const INBOUND_EVENT_ID_VERSION = 'v1';

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function canonicalJid(value?: string | null): string | null {
  const normalized = nonEmpty(value);
  if (!normalized) return null;

  const serviceNormalized = normalized.replace(/@c\.us$/i, '@s.whatsapp.net');
  return serviceNormalized.replace(
    /^([^:@]+):\d+@(s\.whatsapp\.net|lid)$/i,
    '$1@$2'
  );
}

function isLidJid(value: string | null): boolean {
  return value?.endsWith('@lid') === true;
}

export function canonicalInboundRemoteJid(
  key?: IUpsertMessageKey | null,
  serializedRemoteJid?: string | null
): string | null {
  const serialized = canonicalJid(serializedRemoteJid);
  const primary = canonicalJid(key?.remoteJid);
  const alternate = canonicalJid(key?.remoteJidAlt);

  if (alternate && !isLidJid(alternate)) {
    return alternate;
  }
  if (primary && !isLidJid(primary)) {
    return primary;
  }
  if (serialized && !isLidJid(serialized)) {
    return serialized;
  }

  return primary ?? alternate ?? serialized;
}

export function canonicalInboundParticipantJid(
  key?: IUpsertMessageKey | null
): string | null {
  const primary = canonicalJid(key?.participant);
  const alternate = canonicalJid(key?.participantAlt);

  if (alternate && !isLidJid(alternate)) {
    return alternate;
  }
  if (primary && !isLidJid(primary)) {
    return primary;
  }

  return alternate ?? primary;
}

export function canonicalInboundStanzaId(
  messageKeyId?: string | null
): string | null {
  const normalized = nonEmpty(messageKeyId);
  if (!normalized) return null;

  return parseSerializedMessageId(normalized)?.stanzaId ?? normalized;
}

function inboundEventKind(
  upsert: Pick<IUpsertMessage, 'type' | 'is_call_event' | 'message'>
): string {
  if (upsert.is_call_event) {
    return 'call';
  }
  if (inboundMessageHasPinAction(upsert.message?.message)) {
    return 'annotation';
  }

  switch (upsert.type) {
    case EMessageType.edit_text:
      return 'edit';
    case EMessageType.delete_message:
      return 'delete';
    case EMessageType.react:
      return 'reaction';
    case EMessageType.annotation:
      return 'annotation';
    default:
      return 'message';
  }
}

function inboundMessageHasPinAction(
  message?: Record<string, unknown> | null
): boolean {
  let payload = message;
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
  ];

  while (payload && typeof payload === 'object') {
    if (payload.pinInChatMessage || payload.pin_in_chat_message) {
      return true;
    }

    let nested: Record<string, unknown> | null = null;
    for (const wrapper of wrappers) {
      const candidate = payload[wrapper];
      if (!candidate || typeof candidate !== 'object') continue;
      const candidateMessage = (candidate as Record<string, unknown>).message;
      if (candidateMessage && typeof candidateMessage === 'object') {
        nested = candidateMessage as Record<string, unknown>;
        break;
      }
    }
    payload = nested;
  }

  return false;
}

function inboundEventRevision(
  upsert: Pick<
    IUpsertMessage,
    'type' | 'is_call_event' | 'event_revision' | 'message'
  >,
  eventKind: string
): string {
  const explicit = nonEmpty(upsert.event_revision);
  if (explicit) {
    return explicit;
  }
  if (eventKind === 'message') {
    return '';
  }

  const timestamp = Number(upsert.message?.messageTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  const seconds = timestamp >= 1_000_000_000_000 ? timestamp / 1000 : timestamp;
  return String(Math.floor(seconds));
}

/**
 * Builds an identity for the physical WhatsApp event. Message content and the
 * provider implementation are deliberately excluded so repeated content with
 * distinct stanza IDs remains valid and provider redelivery converges.
 */
export function buildInboundEventId(
  upsert: Pick<
    IUpsertMessage,
    | 'account_id'
    | 'worker_id'
    | 'type'
    | 'message'
    | 'event_revision'
    | 'is_call_event'
  >
): string | null {
  const accountId = nonEmpty(upsert.account_id);
  const workerId = nonEmpty(upsert.worker_id);
  const rawKeyId = nonEmpty(upsert.message?.key?.id);
  const parsed = rawKeyId ? parseSerializedMessageId(rawKeyId) : null;
  const stanzaId = parsed?.stanzaId ?? rawKeyId;

  if (!accountId || !workerId || !stanzaId) {
    return null;
  }

  const remoteJid =
    canonicalInboundRemoteJid(upsert.message?.key, parsed?.remoteJid ?? null) ??
    'unknown';
  const participant = canonicalInboundParticipantJid(upsert.message?.key) ?? '';
  const fromMe = parsed?.fromMe ?? upsert.message?.key?.fromMe ?? false;
  const eventKind = inboundEventKind(upsert);
  const revision = inboundEventRevision(upsert, eventKind);
  if (eventKind !== 'message' && !revision) {
    return null;
  }
  const canonical = [
    INBOUND_EVENT_ID_VERSION,
    accountId,
    workerId,
    eventKind,
    remoteJid,
    fromMe ? '1' : '0',
    participant,
    stanzaId,
    revision,
  ].join('\0');

  return `waevt_${INBOUND_EVENT_ID_VERSION}_${createHash('sha256')
    .update(canonical)
    .digest('hex')}`;
}

export function ensureInboundEventId(upsert: IUpsertMessage): string | null {
  const existing = nonEmpty(upsert.event_id);
  if (existing) {
    upsert.event_id = existing;
    return existing;
  }

  const generated = buildInboundEventId(upsert);
  if (generated) {
    upsert.event_id = generated;
  }
  return generated;
}
