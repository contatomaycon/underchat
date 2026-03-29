import type { Message } from '@wwebjs/whatsapp-web.js';
import { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getSerializedIdLike(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return getNonEmptyString(value);
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const valueObject = value as Record<string, unknown>;
  return (
    getNonEmptyString(valueObject._serialized) ??
    getNonEmptyString(valueObject.id)
  );
}

function getMessageIdRemoteValue(
  msg: Message,
  field: 'remoteJid' | 'remote'
): string | undefined {
  if (!msg?.id || typeof msg.id !== 'object' || msg.id === null) {
    return undefined;
  }

  const messageIdLike = msg.id as {
    remoteJid?: unknown;
    remote?: unknown;
  };

  return getSerializedIdLike(messageIdLike[field]);
}

export function messageToWaLike(
  msg: Message | null | undefined
): IMessageKeyResponse | undefined {
  if (!msg?.id) {
    return undefined;
  }

  const id =
    typeof msg.id === 'object' && msg.id !== null && '_serialized' in msg.id
      ? (msg.id as { _serialized: string })._serialized
      : String(msg.id);

  const remoteJid =
    getMessageIdRemoteValue(msg, 'remoteJid') ??
    getMessageIdRemoteValue(msg, 'remote') ??
    msg.to ??
    msg.from ??
    '';
  const isGroup = remoteJid.endsWith('@g.us');
  const author = getNonEmptyString(
    (msg as unknown as { author?: unknown }).author
  );
  const participant = isGroup ? author : undefined;

  return {
    key: {
      id,
      remoteJid,
      remote_jid: remoteJid,
      fromMe: msg.fromMe ?? false,
      from_me: msg.fromMe ?? false,
      participant,
    },
  };
}
