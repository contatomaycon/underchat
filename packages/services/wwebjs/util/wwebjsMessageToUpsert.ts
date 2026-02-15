import type { Message } from '@wwebjs/whatsapp-web.js';
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

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function buildLocationMessage(
  msg: Message
): Record<string, unknown> | undefined {
  const raw = msg as unknown as {
    location?: {
      latitude?: unknown;
      longitude?: unknown;
      name?: unknown;
      address?: unknown;
      description?: unknown;
    };
    _data?: {
      lat?: unknown;
      lng?: unknown;
      loc?: unknown;
    };
  };
  const location = raw.location;
  const data = raw._data;

  const latitude = getNumber(location?.latitude) ?? getNumber(data?.lat);
  const longitude = getNumber(location?.longitude) ?? getNumber(data?.lng);
  const name =
    getNonEmptyString(location?.name) ?? getNonEmptyString(data?.loc);
  const address =
    getNonEmptyString(location?.address) ??
    getNonEmptyString(location?.description) ??
    getNonEmptyString(data?.loc);

  const locationMessage: Record<string, unknown> = {};
  if (latitude !== undefined) {
    locationMessage.degreesLatitude = latitude;
  }
  if (longitude !== undefined) {
    locationMessage.degreesLongitude = longitude;
  }
  if (name) {
    locationMessage.name = name;
  }
  if (address) {
    locationMessage.address = address;
  }

  return Object.keys(locationMessage).length > 0 ? locationMessage : undefined;
}

function getVcards(msg: Message): string[] {
  const raw = msg as unknown as { vCards?: unknown };
  if (!Array.isArray(raw.vCards)) return [];
  return raw.vCards.filter((value): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function getVcardDisplayName(vcard: string): string | undefined {
  const lines = vcard.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('FN:')) {
      return getNonEmptyString(trimmed.slice(3));
    }
  }
  return undefined;
}

function buildContactPayload(
  msg: Message,
  rawType: string,
  body: string
): Record<string, unknown> | undefined {
  const isSingleContact = rawType === 'vcard' || rawType === 'contact';
  const isMultiContact = rawType === 'multi_vcard' || rawType === 'contacts';
  if (!isSingleContact && !isMultiContact) return undefined;

  const vcards = getVcards(msg);
  const bodyVcard = getNonEmptyString(body);
  const raw = msg as unknown as {
    _data?: { vcardFormattedName?: unknown };
  };
  const vcardFormattedName = getNonEmptyString(raw._data?.vcardFormattedName);

  if (isSingleContact) {
    const vcard = vcards[0] ?? bodyVcard;
    if (!vcard) return undefined;

    return {
      contactMessage: {
        vcard,
        displayName: vcardFormattedName ?? getVcardDisplayName(vcard),
      },
    };
  }

  const contactVcards =
    vcards.length > 0 ? vcards : bodyVcard ? [bodyVcard] : [];
  if (!contactVcards.length) return undefined;

  return {
    contactsArrayMessage: {
      contacts: contactVcards.map((vcard) => ({
        vcard,
        displayName: getVcardDisplayName(vcard),
      })),
    },
  };
}

function getDocumentCaption(msg: Message): string | undefined {
  const raw = msg as unknown as {
    _data?: {
      caption?: unknown;
      filename?: unknown;
      isCaptionByUser?: unknown;
    };
  };
  const caption = getNonEmptyString(raw._data?.caption);
  if (!caption) return undefined;

  const filename = getNonEmptyString(raw._data?.filename);
  const isCaptionByUser = raw._data?.isCaptionByUser;

  if (isCaptionByUser === true) {
    return caption;
  }
  if (isCaptionByUser === false) {
    return undefined;
  }

  if (filename && caption === filename) {
    return undefined;
  }

  return caption;
}

function getNotifyNameFromMessage(msg: Message): string | undefined {
  const raw = msg as unknown as {
    _data?: {
      notifyName?: unknown;
    };
  };
  return getNonEmptyString(raw._data?.notifyName);
}

interface WwebjsResolvedJids {
  remoteJid?: string;
  remoteJidAlt?: string;
}

export function wwebjsMessageToUpsert(
  msg: Message,
  resolvedJids?: WwebjsResolvedJids,
  pushName?: string
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

  const rawType = (msg.type ?? 'chat').toLowerCase();
  const body = typeof msg.body === 'string' ? msg.body : '';
  let messageType = mapWwebjsTypeToMessageType(rawType);
  const isViewOnce = (msg as { isViewOnce?: boolean }).isViewOnce === true;
  if (isViewOnce) {
    messageType = EMessageType.view_once;
  }

  const innerMessage: Record<string, unknown> = {};
  if (messageType === EMessageType.text && body) {
    innerMessage.conversation = body;
    innerMessage.extendedTextMessage = { text: body };
  }
  if (rawType === 'document') {
    const caption = getDocumentCaption(msg);
    if (caption) {
      innerMessage.documentMessage = { caption };
    }
  }
  if (rawType === 'location') {
    const locationMessage = buildLocationMessage(msg);
    if (locationMessage) {
      innerMessage.locationMessage = locationMessage;
    }
  }
  const contactPayload = buildContactPayload(msg, rawType, body);
  if (contactPayload) {
    Object.assign(innerMessage, contactPayload);
  }
  if (
    Object.keys(innerMessage).length === 0 &&
    body &&
    rawType !== 'location' &&
    rawType !== 'document' &&
    rawType !== 'vcard' &&
    rawType !== 'contact' &&
    rawType !== 'multi_vcard' &&
    rawType !== 'contacts'
  ) {
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
    pushName: pushName ?? getNotifyNameFromMessage(msg),
  };

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: messageType,
    message: envelope,
    has_quoted: msg.hasQuotedMsg ?? false,
  };
}
