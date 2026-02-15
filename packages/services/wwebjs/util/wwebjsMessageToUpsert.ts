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

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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

function getRawMessageData(msg: Message): Record<string, unknown> | undefined {
  const rawData = (msg as unknown as { rawData?: unknown }).rawData;
  if (rawData && typeof rawData === 'object') {
    return rawData as Record<string, unknown>;
  }

  const data = (msg as unknown as { _data?: unknown })._data;
  if (data && typeof data === 'object') {
    return data as Record<string, unknown>;
  }

  return undefined;
}

function getSerializedId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return getNonEmptyString(value);
  }
  if (typeof value !== 'object') return undefined;

  const objectValue = value as Record<string, unknown>;
  const directKeys = ['_serialized', 'id', 'stanzaId', 'stanzaID'];
  for (const key of directKeys) {
    const candidate = objectValue[key];
    if (typeof candidate === 'string') {
      const normalized = getNonEmptyString(candidate);
      if (normalized) return normalized;
    }
  }

  return undefined;
}

function getQuotedIdFromRaw(raw?: Record<string, unknown>): string | undefined {
  if (!raw) return undefined;

  const directKeys = [
    'quotedStanzaID',
    'quotedStanzaId',
    'quotedMsgId',
    'quotedMsgID',
    'quotedMessageId',
    'quotedMessageID',
  ];
  for (const key of directKeys) {
    const quotedId = getSerializedId(raw[key]);
    if (quotedId) return quotedId;
  }

  const keyLikeKeys = [
    'quotedMsgKey',
    'quotedMessageKey',
    'quotedParentMsgKey',
    'quotedMsg',
    'quotedMessage',
  ];
  for (const key of keyLikeKeys) {
    const keyLike = raw[key];
    const quotedId = getSerializedId(keyLike);
    if (quotedId) return quotedId;

    if (keyLike && typeof keyLike === 'object') {
      const nestedId = getSerializedId((keyLike as Record<string, unknown>).id);
      if (nestedId) return nestedId;
    }
  }

  return undefined;
}

function getQuotedParticipantFromRaw(
  raw?: Record<string, unknown>
): string | undefined {
  if (!raw) return undefined;

  const candidateKeys = [
    'quotedParticipant',
    'quotedParticipantId',
    'quotedAuthor',
  ];
  for (const key of candidateKeys) {
    const participant =
      getSerializedId(raw[key]) ?? getNonEmptyString(raw[key]);
    if (!participant) continue;
    const normalized = normalizeJid(participant) ?? participant;
    if (!normalized.endsWith('@g.us')) {
      return normalized;
    }
  }

  return undefined;
}

function resolveQuotedParticipant(msg: Message): string | undefined {
  const author = getNonEmptyString(
    (msg as unknown as { author?: unknown }).author
  );
  if (author) {
    return normalizeJid(author) ?? author;
  }

  const from = getNonEmptyString(msg.from);
  if (from && !from.endsWith('@g.us')) {
    return normalizeJid(from) ?? from;
  }

  return undefined;
}

function buildQuotedProtoMessage(
  quoted: Message
): Record<string, unknown> | undefined {
  const rawType = (quoted.type ?? 'chat').toLowerCase();
  const body = typeof quoted.body === 'string' ? quoted.body : '';
  const raw = quoted as unknown as {
    _data?: {
      mimetype?: unknown;
      filename?: unknown;
      duration?: unknown;
      seconds?: unknown;
      isAnimated?: unknown;
      width?: unknown;
      height?: unknown;
    };
  };
  const rawData = raw._data;

  if (rawType === 'chat') {
    return {
      conversation: body,
      extendedTextMessage: { text: body },
    };
  }

  if (rawType === 'image') {
    return {
      imageMessage: {
        caption: body || undefined,
        mimetype: getNonEmptyString(rawData?.mimetype),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'video') {
    return {
      videoMessage: {
        caption: body || undefined,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'ptt') {
    return {
      audioMessage: {
        ptt: true,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
      },
    };
  }

  if (rawType === 'audio') {
    return {
      audioMessage: {
        ptt: false,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
      },
    };
  }

  if (rawType === 'sticker') {
    return {
      stickerMessage: {
        mimetype: getNonEmptyString(rawData?.mimetype),
        isAnimated: getBoolean(rawData?.isAnimated),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'document') {
    const caption = getDocumentCaption(quoted) ?? body;
    return {
      documentMessage: {
        caption: caption || undefined,
        fileName: getNonEmptyString(rawData?.filename),
        mimetype: getNonEmptyString(rawData?.mimetype),
      },
    };
  }

  if (rawType === 'location') {
    const locationMessage = buildLocationMessage(quoted);
    if (!locationMessage) return undefined;
    return { locationMessage };
  }

  if (
    rawType === 'vcard' ||
    rawType === 'contact' ||
    rawType === 'multi_vcard' ||
    rawType === 'contacts'
  ) {
    const contactPayload = buildContactPayload(quoted, rawType, body) as
      | {
          contactMessage?: Record<string, unknown>;
          contactsArrayMessage?: { contacts?: Array<Record<string, unknown>> };
        }
      | undefined;
    const singleContact = contactPayload?.contactMessage;
    if (singleContact) {
      return { contactMessage: singleContact };
    }

    const firstContact = contactPayload?.contactsArrayMessage?.contacts?.[0];
    if (firstContact?.vcard) {
      return {
        contactMessage: {
          vcard: firstContact.vcard,
          displayName: firstContact.displayName,
        },
      };
    }
  }

  if (body) {
    return {
      conversation: body,
      extendedTextMessage: { text: body },
    };
  }

  return undefined;
}

async function buildQuotedContextInfo(
  msg: Message
): Promise<Record<string, unknown> | undefined> {
  if (!msg.hasQuotedMsg) return undefined;

  const rawData = getRawMessageData(msg);
  const rawQuotedId = getQuotedIdFromRaw(rawData);
  const rawParticipant = getQuotedParticipantFromRaw(rawData);

  try {
    const quoted = await msg.getQuotedMessage();
    if (quoted) {
      const stanzaId = getMessageId(quoted) ?? rawQuotedId;
      if (!stanzaId) return undefined;

      const quotedMessage = buildQuotedProtoMessage(quoted) ?? {};
      const participant = resolveQuotedParticipant(quoted) ?? rawParticipant;
      const contextInfo: Record<string, unknown> = {
        stanzaId,
        quotedMessage,
      };

      if (participant) {
        contextInfo.participant = participant;
      }

      return contextInfo;
    }
  } catch {}

  if (!rawQuotedId) return undefined;

  const contextInfo: Record<string, unknown> = {
    stanzaId: rawQuotedId,
    quotedMessage: {},
  };

  if (rawParticipant) {
    contextInfo.participant = rawParticipant;
  }

  return contextInfo;
}

interface WwebjsResolvedJids {
  remoteJid?: string;
  remoteJidAlt?: string;
}

export async function wwebjsMessageToUpsert(
  msg: Message,
  resolvedJids?: WwebjsResolvedJids,
  pushName?: string
): Promise<IUpsertMessage | null> {
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

  const quotedContextInfo = await buildQuotedContextInfo(msg);
  if (quotedContextInfo) {
    const currentExtendedText = (innerMessage.extendedTextMessage ??
      {}) as Record<string, unknown>;
    innerMessage.extendedTextMessage = {
      ...currentExtendedText,
      contextInfo: quotedContextInfo,
    };
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
      participant: resolveGroupParticipant(msg, remoteJid),
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
    has_quoted: (msg.hasQuotedMsg ?? false) || !!quotedContextInfo,
  };
}
