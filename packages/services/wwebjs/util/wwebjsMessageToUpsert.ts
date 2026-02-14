import type { Message } from 'whatsapp-web.js';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { wwebjsEnvironment } from '@core/config/environments';
import { messageToWaLike } from './messageToWaLike';
import { normalizeJid } from '@core/common/functions/normalizeJid';

function getMessageId(msg: Message): string | undefined {
  if (!msg?.id) return undefined;
  if (
    typeof msg.id === 'object' &&
    msg.id !== null &&
    '_serialized' in msg.id
  ) {
    return (msg.id as { _serialized: string })._serialized;
  }
  return String(msg.id);
}

function mapWwebjsTypeToMessageType(type: string | undefined): EMessageType {
  const t = (type ?? 'chat').toLowerCase();
  if (t === 'chat') return EMessageType.text;
  if (t === 'image') return EMessageType.image;
  if (t === 'video') return EMessageType.video;
  if (t === 'ptt' || t === 'audio') return EMessageType.audio;
  if (t === 'sticker') return EMessageType.sticker;
  if (t === 'document') return EMessageType.document;
  if (t === 'location') return EMessageType.location;
  if (t === 'contacts' || t === 'multi_vcard') return EMessageType.contacts;
  if (t === 'contact' || t === 'vcard') return EMessageType.contact_card;
  return EMessageType.text;
}

interface WwebjsResolvedJids {
  remoteJid?: string;
  remoteJidAlt?: string;
}

export function wwebjsMessageToUpsert(
  msg: Message,
  resolvedJids?: WwebjsResolvedJids
): IUpsertMessage | null {
  const keyLike = messageToWaLike(msg);
  if (!keyLike?.key) return null;

  const id = getMessageId(msg);
  if (!id) return null;

  const fallbackRemoteJidRaw = msg.fromMe
    ? msg.to || msg.from || ''
    : msg.from || msg.to || '';
  const fallbackRemoteJid =
    normalizeJid(fallbackRemoteJidRaw) ?? fallbackRemoteJidRaw;
  const remoteJid = resolvedJids?.remoteJid ?? fallbackRemoteJid;
  if (!remoteJid) return null;
  const remoteJidAlt = resolvedJids?.remoteJidAlt;

  const body = typeof msg.body === 'string' ? msg.body : '';
  let messageType = mapWwebjsTypeToMessageType(msg.type);
  const isViewOnce = (msg as { isViewOnce?: boolean }).isViewOnce === true;
  if (isViewOnce) {
    messageType = EMessageType.view_once;
  }

  const innerMessage: Record<string, unknown> = {};
  if (messageType === EMessageType.text && body) {
    innerMessage.conversation = body;
    innerMessage.extendedTextMessage = { text: body };
  }
  if (Object.keys(innerMessage).length === 0 && body) {
    innerMessage.conversation = body;
  }

  const envelope: IUpsertMessage['message'] = {
    key: {
      id,
      remoteJid,
      remoteJidAlt,
      fromMe: msg.fromMe ?? false,
      participant: msg.from?.includes('@g.us') ? msg.from : undefined,
      isViewOnce: isViewOnce || undefined,
    },
    message: innerMessage,
    messageTimestamp: msg.timestamp,
    pushName: undefined,
  };

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: messageType,
    message: envelope,
    has_quoted: msg.hasQuotedMsg ?? false,
  };
}
