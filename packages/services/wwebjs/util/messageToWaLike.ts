import type { Message } from '@wwebjs/whatsapp-web.js';
import { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

  const remoteJid = msg.to || msg.from || '';
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
