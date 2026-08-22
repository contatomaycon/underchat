import { createHash } from 'node:crypto';
import type { IMessageStatusUpdate } from '../interfaces/IMessageStatusUpdate';
import { parseSerializedMessageId } from './parseSerializedMessageId';

const MESSAGE_STATUS_EVENT_ID_VERSION = 'v1';

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function canonicalMessageStatusMessageId(
  value?: string | null
): string | null {
  const messageId = nonEmpty(value);
  if (!messageId) {
    return null;
  }
  return parseSerializedMessageId(messageId)?.stanzaId ?? messageId;
}

function statusRevision(
  data: Pick<IMessageStatusUpdate, 'patch' | 'failed' | 'ambiguous'>
): string {
  if (data.failed === true && data.ambiguous === true) return 'ambiguous';
  if (data.failed === true) return 'failed';
  if (data.patch.is_seen === true) return 'seen';
  if (data.patch.is_delivered === true) return 'delivered';
  if (data.patch.is_sent === true) return 'sent';
  return 'unknown';
}

export function buildMessageStatusEventId(
  data: Pick<
    IMessageStatusUpdate,
    'account_id' | 'worker_id' | 'message_id' | 'patch' | 'failed' | 'ambiguous'
  >
): string | null {
  const accountId = nonEmpty(data.account_id);
  const workerId = nonEmpty(data.worker_id);
  const messageId = canonicalMessageStatusMessageId(data.message_id);
  if (!accountId || !workerId || !messageId) {
    return null;
  }

  const canonical = [
    MESSAGE_STATUS_EVENT_ID_VERSION,
    accountId,
    workerId,
    messageId,
    statusRevision(data),
  ].join('\0');

  return `message_status_${MESSAGE_STATUS_EVENT_ID_VERSION}_${createHash(
    'sha256'
  )
    .update(canonical)
    .digest('hex')}`;
}

export function ensureMessageStatusEventId(
  data: IMessageStatusUpdate
): string | null {
  const existing = nonEmpty(data.event_id);
  if (existing) {
    data.event_id = existing;
    return existing;
  }

  const generated = buildMessageStatusEventId(data);
  if (generated) {
    data.event_id = generated;
  }
  return generated;
}
