import type { Message } from '@wwebjs/whatsapp-web.js';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { wwebjsEnvironment } from '@core/config/environments';
import { normalizeJid } from '@core/common/functions/normalizeJid';

function getMessageId(msg: { id?: unknown }): string | undefined {
  if (!msg?.id) return undefined;
  if (
    typeof msg.id === 'object' &&
    msg.id !== null &&
    '_serialized' in (msg.id as object)
  ) {
    return (msg.id as { _serialized: string })._serialized;
  }
  return String(msg.id);
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface WwebjsResolvedJids {
  remoteJid?: string;
  remoteJidAlt?: string;
}

function getRemoteJid(msg: Message): string {
  const raw = msg.fromMe ? msg.to || msg.from || '' : msg.from || msg.to || '';
  return normalizeJid(raw) ?? raw;
}

function resolveGroupParticipant(
  msg: Message,
  remoteJid: string
): string | undefined {
  if (!remoteJid.endsWith('@g.us')) return undefined;

  const author = getNonEmptyString(
    (msg as unknown as { author?: unknown }).author
  );
  if (author) {
    const normalized = normalizeJid(author) ?? author;
    if (normalized !== remoteJid) return normalized;
  }

  const from = getNonEmptyString(msg.from);
  if (from) {
    const normalized = normalizeJid(from) ?? from;
    if (normalized !== remoteJid && !normalized.endsWith('@g.us')) {
      return normalized;
    }
  }

  return undefined;
}

export function buildDeleteMessageUpsert(
  after: Message,
  before: Message | null | undefined,
  resolvedJids?: WwebjsResolvedJids
): IUpsertMessage | null {
  const deletedId = before ? getMessageId(before) : getMessageId(after);
  if (!deletedId) return null;

  const remoteJid = resolvedJids?.remoteJid ?? getRemoteJid(after);
  if (!remoteJid) return null;
  const remoteJidAlt = resolvedJids?.remoteJidAlt;
  const participant =
    resolveGroupParticipant(after, remoteJid) ??
    (before ? resolveGroupParticipant(before, remoteJid) : undefined);

  const id = getMessageId(after) ?? `revoke_${deletedId}_${Date.now()}`;

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: EMessageType.delete_message,
    message: {
      key: {
        id,
        remoteJid,
        remoteJidAlt,
        fromMe: after.fromMe ?? false,
        participant,
      },
      message: {
        protocolMessage: {
          key: { id: deletedId },
        },
      },
      messageTimestamp: after.timestamp,
    },
    has_quoted: false,
  };
}

export function buildRevokeMeUpsert(
  msg: Message,
  resolvedJids?: WwebjsResolvedJids
): IUpsertMessage | null {
  const deletedId = getMessageId(msg);
  if (!deletedId) return null;

  const remoteJid = resolvedJids?.remoteJid ?? getRemoteJid(msg);
  if (!remoteJid) return null;
  const remoteJidAlt = resolvedJids?.remoteJidAlt;
  const participant = resolveGroupParticipant(msg, remoteJid);

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: EMessageType.delete_message,
    message: {
      key: {
        id: `revoke_me_${deletedId}_${Date.now()}`,
        remoteJid,
        remoteJidAlt,
        fromMe: msg.fromMe ?? false,
        participant,
      },
      message: {
        protocolMessage: {
          key: { id: deletedId },
        },
      },
      messageTimestamp: msg.timestamp,
    },
    has_quoted: false,
  };
}

export function buildEditMessageUpsert(
  message: Message,
  newBody: string,
  resolvedJids?: WwebjsResolvedJids
): IUpsertMessage | null {
  const id = getMessageId(message);
  if (!id) return null;

  const remoteJid = resolvedJids?.remoteJid ?? getRemoteJid(message);
  if (!remoteJid) return null;
  const remoteJidAlt = resolvedJids?.remoteJidAlt;
  const participant = resolveGroupParticipant(message, remoteJid);

  const protocolMessage = {
    key: { id },
    editedMessage: {
      conversation: newBody,
      extendedTextMessage: { text: newBody },
    },
  };

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: EMessageType.edit_text,
    message: {
      key: {
        id: `edit_${id}_${Date.now()}`,
        remoteJid,
        remoteJidAlt,
        fromMe: message.fromMe ?? false,
        participant,
      },
      message: {
        editedMessage: {
          message: {
            protocolMessage,
          },
        },
        protocolMessage,
      },
      messageTimestamp: message.timestamp,
    },
    has_quoted: message.hasQuotedMsg ?? false,
  };
}

export function buildReactionUpsert(
  remoteJid: string,
  remoteJidAlt: string | undefined,
  reactionId: string,
  targetMessageId: string,
  emoji: string,
  fromMe: boolean,
  participant: string | undefined,
  timestamp: number
): IUpsertMessage {
  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: EMessageType.react,
    message: {
      key: {
        id: reactionId,
        remoteJid,
        remoteJidAlt,
        fromMe,
        participant,
      },
      message: {
        reactionMessage: {
          key: { id: targetMessageId },
          text: emoji,
        },
      },
      messageTimestamp: timestamp,
    },
    has_quoted: false,
  };
}

export function buildCallUpsert(
  callJid: string,
  callName: string | null,
  callPhone: string
): IUpsertMessage {
  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: EMessageType.system,
    message: {} as IUpsertMessage['message'],
    has_quoted: false,
    is_call_event: true,
    call_phone: callPhone,
    call_jid: callJid,
    call_name: callName,
  };
}
