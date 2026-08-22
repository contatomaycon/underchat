import { createHash } from 'node:crypto';
import { IUpdateMessage } from '../interfaces/IUpdateMessage';
import { parseSerializedMessageId } from './parseSerializedMessageId';

const MESSAGE_UPDATE_EVENT_ID_VERSION = 'v1';

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveWorkerId(data: IUpdateMessage): string | null {
  return nonEmpty(data.worker_id) ?? nonEmpty(data.data?.worker?.id);
}

export function buildMessageUpdateKafkaKey(data: IUpdateMessage): string {
  const accountId = nonEmpty(data.data?.account?.id) ?? 'unknown-account';
  const workerId = resolveWorkerId(data) ?? 'unknown-worker';
  const messageId =
    nonEmpty(data.data?.message_id) ??
    nonEmpty(data.message?.key?.id) ??
    'unknown-message';
  return `${accountId}:${workerId}:${messageId}`;
}

export function buildMessageUpdateEventId(data: IUpdateMessage): string | null {
  const accountId = nonEmpty(data.data?.account?.id);
  const workerId = resolveWorkerId(data);
  const internalMessageId = nonEmpty(data.data?.message_id);
  const rawProviderMessageId = nonEmpty(data.message?.key?.id);
  const providerMessageId = rawProviderMessageId
    ? (parseSerializedMessageId(rawProviderMessageId)?.stanzaId ??
      rawProviderMessageId)
    : null;

  if (!accountId || !workerId || !internalMessageId || !providerMessageId) {
    return null;
  }

  const canonical = [
    MESSAGE_UPDATE_EVENT_ID_VERSION,
    accountId,
    workerId,
    internalMessageId,
    providerMessageId,
  ].join('\0');

  return `message_update_${MESSAGE_UPDATE_EVENT_ID_VERSION}_${createHash(
    'sha256'
  )
    .update(canonical)
    .digest('hex')}`;
}

export function ensureMessageUpdateIdentity(data: IUpdateMessage): void {
  data.worker_id = resolveWorkerId(data) ?? undefined;
  const existingEventId = nonEmpty(data.event_id);
  if (existingEventId) {
    data.event_id = existingEventId;
    return;
  }

  data.event_id = buildMessageUpdateEventId(data) ?? undefined;
}
