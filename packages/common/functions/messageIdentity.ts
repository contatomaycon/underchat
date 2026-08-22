import { createHash } from 'node:crypto';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';

const MESSAGE_IDENTITY_VERSION = 'v1';
const messageSendOperationOverrides = new WeakMap<object, string>();

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

/** Stable fan-out identity: target order can never change an operation ID. */
export function buildForwardWorkerCommandOperationId(
  idempotencyKey: string,
  targetChatId: string
): string {
  return createHash('sha256')
    .update(`forward:v1\0${idempotencyKey.trim()}\0${targetChatId.trim()}`)
    .digest('hex');
}

export function buildMessageSendQueueKey(
  accountId: string,
  chatId: string
): string {
  return `chat:${accountId.trim()}:${chatId.trim()}`;
}

export function buildWorkerCommandChatEntityKey(
  accountId: string,
  workerId: string,
  canonicalJidOrChatId: string
): string {
  return `chat:${accountId.trim()}:${workerId.trim()}:${canonicalJidOrChatId.trim()}`;
}

export function resolveWorkerCommandChatEntityKey(
  accountId: string,
  workerId: string,
  input: {
    chat_id?: unknown;
    message_key?: { remote_jid?: unknown } | null;
  }
): string {
  const canonicalJid = normalizeNonEmptyString(input.message_key?.remote_jid);
  const chatId = normalizeNonEmptyString(input.chat_id);
  const identity = canonicalJid ?? chatId;
  if (!identity) {
    throw new Error('worker_command_chat_identity_missing');
  }
  return buildWorkerCommandChatEntityKey(accountId, workerId, identity);
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

export function resolveMessageSendOperationId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const transportOperationId = messageSendOperationOverrides.get(payload);
  if (transportOperationId) return transportOperationId;

  const message = payload as Partial<IChatMessage> & {
    account?: { id?: unknown } | null;
  };
  const messageId = normalizeNonEmptyString(message.message_id);
  if (!messageId) {
    return null;
  }

  const providedHash = normalizeNonEmptyString(message.hash);
  if (!providedHash) {
    return messageId;
  }

  const accountId = normalizeNonEmptyString(message.account?.id);
  const chatId = normalizeNonEmptyString(message.chat_id);
  if (
    accountId &&
    chatId &&
    providedHash === buildDeterministicMessageHash(accountId, chatId, messageId)
  ) {
    return messageId;
  }

  return providedHash;
}

/** Bind the envelope identity without changing the UI-facing message hash. */
export function bindMessageSendOperationId(
  payload: object,
  operationId: string
): void {
  const normalized = operationId.trim();
  if (!normalized) throw new Error('message_send_operation_id_invalid');
  messageSendOperationOverrides.set(payload, normalized);
}

export function ensureMessageSendHash(message: IChatMessage): string | null {
  const identity = resolveMessageSendIdentity(message);
  if (!identity) {
    return null;
  }

  message.hash = identity.hash;
  return identity.hash;
}
