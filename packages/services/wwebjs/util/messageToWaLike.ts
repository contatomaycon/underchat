import type { Message } from 'whatsapp-web.js';
import { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';

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

  return {
    key: {
      id,
      remoteJid,
      remote_jid: remoteJid,
      fromMe: msg.fromMe ?? false,
      from_me: msg.fromMe ?? false,
      participant: msg.from?.includes('@g.us') ? msg.from : undefined,
    },
  };
}
