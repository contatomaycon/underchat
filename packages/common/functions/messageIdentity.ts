import { createHash } from 'node:crypto';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';

const MESSAGE_IDENTITY_VERSION = 'v1';

export interface IMessageSendIdentity {
  accountId: string;
  chatId: string;
  messageId: string;
  hash: string;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildDeterministicMessageHash(
  accountId: string,
  chatId: string,
  messageId: string
): string {
  return createHash('sha256')
    .update(
      `${MESSAGE_IDENTITY_VERSION}|${accountId.trim()}|${chatId.trim()}|${messageId.trim()}`
    )
    .digest('hex');
}

export function buildMessageSendQueueKey(
  accountId: string,
  chatId: string
): string {
  return `chat:${accountId.trim()}:${chatId.trim()}`;
}

export function buildScheduleSendQueueKey(
  accountId: string,
  workerId: string
): string {
  return `account:${accountId.trim()}:channel:${workerId.trim()}`;
}

export function resolveMessageSendQueueKey(payload: unknown): string | null {
  const identity = resolveMessageSendIdentity(payload);
  if (!identity) {
    return null;
  }

  return buildMessageSendQueueKey(identity.accountId, identity.chatId);
}

export function resolveMessageSendIdentity(
  payload: unknown
): IMessageSendIdentity | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const message = payload as Partial<IChatMessage> & {
    account?: { id?: unknown } | null;
  };

  const accountId = normalizeNonEmptyString(message.account?.id);
  const chatId = normalizeNonEmptyString(message.chat_id);
  const messageId = normalizeNonEmptyString(message.message_id);

  if (!accountId || !chatId || !messageId) {
    return null;
  }

  const normalizedHash = normalizeNonEmptyString(message.hash);
  const hash =
    normalizedHash ??
    buildDeterministicMessageHash(accountId, chatId, messageId);

  return {
    accountId,
    chatId,
    messageId,
    hash,
  };
}

export function ensureMessageSendHash(message: IChatMessage): string | null {
  const identity = resolveMessageSendIdentity(message);
  if (!identity) {
    return null;
  }

  message.hash = identity.hash;
  return identity.hash;
}
