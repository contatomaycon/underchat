import type { Message } from '@wwebjs/whatsapp-web.js';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { IWwebjsPinEventData } from '@core/common/interfaces/IWwebjsPinEventData';
import { EMessageType } from '@core/common/enums/EMessageType';
import { wwebjsEnvironment } from '@core/config/environments';
import { messageToWaLike } from './messageToWaLike';
import { normalizeJid } from '@core/common/functions/normalizeJid';

const E2E_ENCRYPT_NOTIFICATION_TEXT =
  'As mensagens e chamadas são protegidas com criptografia de ponta a ponta. Ninguém fora desta conversa, nem mesmo o WhatsApp, pode ler ou ouvi-las.';
const CIPHERTEXT_FANOUT_NOTIFICATION_TEXT =
  'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';

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

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mapWwebjsTypeToMessageType(
  type: string | undefined,
  rawData?: Record<string, unknown>
): EMessageType {
  const t = (type ?? 'chat').toLowerCase();
  const subType = getNonEmptyString(rawData?.subtype)?.toLowerCase();

  if (
    t === 'protocol' &&
    (subType === 'ephemeral_setting' || subType === 'ephemeral_sync_response')
  ) {
    return EMessageType.set_disappearing_messages;
  }

  if (
    t === 'ciphertext' &&
    (subType === 'view_once_unavailable_fanout' ||
      subType?.startsWith('view_once_unavailable_'))
  ) {
    return EMessageType.view_once;
  }

  if (t === 'ciphertext' && subType === 'fanout') {
    return EMessageType.system;
  }

  if (t === 'chat') return EMessageType.text;
  if (t === 'image') return EMessageType.image;
  if (t === 'video') return EMessageType.video;
  if (t === 'ptv') return EMessageType.video_note;
  if (t === 'ptt' || t === 'audio') return EMessageType.audio;
  if (t === 'sticker') return EMessageType.sticker;
  if (t === 'document') return EMessageType.document;
  if (t === 'location') return EMessageType.location;
  if (t === 'contacts' || t === 'multi_vcard') return EMessageType.contacts;
  if (t === 'contact' || t === 'vcard') return EMessageType.contact_card;
  if (t === 'pin_message' || t === 'pinned_message') {
    return EMessageType.system;
  }
  if (t === 'e2e_notification') return EMessageType.system;
  return EMessageType.text;
}

function resolveE2ENotificationBody(
  rawType: string,
  rawSubType?: string
): string | undefined {
  if (rawType !== 'e2e_notification') {
    return undefined;
  }

  if (!rawSubType || rawSubType === 'encrypt') {
    return E2E_ENCRYPT_NOTIFICATION_TEXT;
  }

  return undefined;
}

function resolveCiphertextFallbackBody(
  rawType: string,
  rawSubType?: string
): string | undefined {
  if (rawType !== 'ciphertext') {
    return undefined;
  }

  if (rawSubType === 'fanout') {
    return CIPHERTEXT_FANOUT_NOTIFICATION_TEXT;
  }

  return undefined;
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

function isLikelyBase64MediaPayload(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('data:image/')) return true;
  if (normalized.length < 256) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false;

  return (
    normalized.startsWith('iVBORw0KGgo') ||
    normalized.startsWith('/9j/') ||
    normalized.startsWith('R0lGOD') ||
    normalized.startsWith('UklGR')
  );
}

function resolveMessageBody(
  rawType: string,
  body: string,
  rawData?: Record<string, unknown>
): string {
  const caption = getNonEmptyString(rawData?.caption);
  const isMediaType =
    rawType === 'image' || rawType === 'video' || rawType === 'ptv';

  if (!body) {
    return caption ?? '';
  }

  if (isMediaType && caption && isLikelyBase64MediaPayload(body)) {
    return caption;
  }

  return body;
}

function getPinTypeValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && String(parsed) === trimmed) {
    return parsed;
  }

  return trimmed;
}

function resolvePinType(
  rawType: string,
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData
): string | number | undefined {
  const candidates = [
    pinEventData?.pinType,
    rawData?.pinMessageType,
    rawData?.pinType,
    rawData?.pinActionType,
    rawData?.pinAction,
  ];

  for (const candidate of candidates) {
    const value = getPinTypeValue(candidate);
    if (value !== undefined) {
      return value;
    }
  }

  if (pinEventData?.isPinned === false) {
    return 'UNPIN';
  }
  if (pinEventData?.isPinned === true) {
    return 'PIN';
  }

  if (rawType === 'pinned_message') {
    return 'PIN';
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

function resolvePinParentMessageId(
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData
): string | undefined {
  const candidates: unknown[] = [
    pinEventData?.parentMessageId,
    rawData?.pinParentKey,
    rawData?.parentMsgKey,
    rawData?.targetMsgKey,
  ];

  for (const candidate of candidates) {
    const serializedId = getSerializedId(candidate);
    if (serializedId) {
      return serializedId;
    }
  }

  return undefined;
}

function buildPinInChatMessage(
  rawType: string,
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData
): Record<string, unknown> | undefined {
  const hasPinSignals =
    rawType === 'pin_message' ||
    rawType === 'pinned_message' ||
    pinEventData !== undefined ||
    rawData?.pinMessageType !== undefined ||
    rawData?.pinType !== undefined ||
    rawData?.pinParentKey !== undefined ||
    rawData?.parentMsgKey !== undefined;

  if (!hasPinSignals) {
    return undefined;
  }

  const pinType = resolvePinType(rawType, rawData, pinEventData);
  const parentMessageId = resolvePinParentMessageId(rawData, pinEventData);

  if (pinType === undefined && !parentMessageId) {
    return undefined;
  }

  const pinPayload: Record<string, unknown> = {};
  if (parentMessageId) {
    pinPayload.key = { id: parentMessageId };
  }
  if (pinType !== undefined) {
    pinPayload.type = pinType;
  }

  return pinPayload;
}

function getEphemeralExpiration(rawData?: Record<string, unknown>): number {
  const candidates = [
    rawData?.ephemeralDuration,
    rawData?.ephemeralExpiration,
    rawData?.disappearingMessagesInChat,
  ];

  for (const candidate of candidates) {
    const value = getNumber(candidate);
    if (value !== undefined) {
      return value > 0 ? value : 0;
    }
  }

  if (rawData?.disappearingMessagesInChat === false) {
    return 0;
  }

  return 0;
}

function buildDisappearingProtocolMessage(
  rawType: string,
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (rawType !== 'protocol') {
    return undefined;
  }

  const subType = getNonEmptyString(rawData?.subtype)?.toLowerCase();
  if (
    subType !== 'ephemeral_setting' &&
    subType !== 'ephemeral_sync_response'
  ) {
    return undefined;
  }

  const expiration = getEphemeralExpiration(rawData);
  return {
    protocolMessage: {
      ephemeralExpiration: expiration,
    },
  };
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

function getObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function buildForwardedContextInfo(
  msg: Message
): Record<string, unknown> | undefined {
  const rawData = getRawMessageData(msg);

  const topIsForwarded = getBoolean(
    (msg as unknown as { isForwarded?: unknown }).isForwarded
  );
  const rawIsForwarded = getBoolean(rawData?.isForwarded);

  const topForwardingScore = getNumber(
    (msg as unknown as { forwardingScore?: unknown }).forwardingScore
  );
  const rawForwardingScore =
    getNumber(rawData?.forwardingScore) ?? getNumber(rawData?.forwardsCount);
  const forwardingScore = topForwardingScore ?? rawForwardingScore;
  const inferredForwardedByScore =
    forwardingScore !== undefined && forwardingScore > 0;
  const isForwarded = topIsForwarded ?? rawIsForwarded;

  if (isForwarded !== true && !inferredForwardedByScore) {
    return undefined;
  }

  const contextInfo: Record<string, unknown> = {
    isForwarded: true,
  };

  if (forwardingScore !== undefined) {
    contextInfo.forwardingScore = forwardingScore;
  }

  return contextInfo;
}

function getJsonString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = getNonEmptyString(value);
    return normalized;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    return getNonEmptyString(serialized);
  } catch {
    return undefined;
  }
}

function buildExternalAdReplyFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const conversionData =
    getObjectRecord(ctwaContext?.conversionData) ??
    getObjectRecord(rawData.conversionData);

  const externalAdReply: Record<string, unknown> = {};

  const title =
    getNonEmptyString(ctwaContext?.title) ?? getNonEmptyString(rawData.title);
  if (title) externalAdReply.title = title;

  const mediaType =
    getNumber(ctwaContext?.mediaType) ??
    getNumber(rawData.mediaType) ??
    getNumber(rawData.richPreviewType);
  if (mediaType !== undefined) externalAdReply.mediaType = mediaType;

  const thumbnailUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl) ??
    getNonEmptyString(ctwaContext?.thumbnailUrl) ??
    getNonEmptyString(rawData.thumbnailUrl);
  if (thumbnailUrl) externalAdReply.thumbnailUrl = thumbnailUrl;

  const sourceType =
    getNonEmptyString(ctwaContext?.sourceType) ??
    getNonEmptyString(rawData.sourceType);
  if (sourceType) externalAdReply.sourceType = sourceType;

  const sourceId =
    getNonEmptyString(ctwaContext?.sourceId) ??
    getNonEmptyString(rawData.sourceId);
  if (sourceId) externalAdReply.sourceId = sourceId;

  const sourceUrl =
    getNonEmptyString(ctwaContext?.sourceUrl) ??
    getNonEmptyString(rawData.sourceUrl);
  if (sourceUrl) externalAdReply.sourceUrl = sourceUrl;

  const containsAutoReply =
    getBoolean(ctwaContext?.containsAutoReply) ??
    getBoolean(rawData.containsAutoReply);
  if (containsAutoReply !== undefined) {
    externalAdReply.containsAutoReply = containsAutoReply;
  }

  const renderLargerThumbnail =
    getBoolean(ctwaContext?.renderLargerThumbnail) ??
    getBoolean(rawData.renderLargerThumbnail);
  if (renderLargerThumbnail !== undefined) {
    externalAdReply.renderLargerThumbnail = renderLargerThumbnail;
  }

  const showAdAttribution =
    getBoolean(ctwaContext?.showAdAttribution) ??
    getBoolean(rawData.showAdAttribution);
  if (showAdAttribution !== undefined) {
    externalAdReply.showAdAttribution = showAdAttribution;
  }

  const ctwaClid =
    getNonEmptyString(ctwaContext?.ctwaClid) ??
    getNonEmptyString(rawData.ctwaClid) ??
    getNonEmptyString(conversionData?.ctwaClid) ??
    getNonEmptyString(conversionData?.ctwa_clid) ??
    getNonEmptyString(conversionData?.clid);
  if (ctwaClid) externalAdReply.ctwaClid = ctwaClid;

  const clickToWhatsappCall =
    getBoolean(ctwaContext?.clickToWhatsappCall) ??
    getBoolean(rawData.clickToWhatsappCall);
  if (clickToWhatsappCall !== undefined) {
    externalAdReply.clickToWhatsappCall = clickToWhatsappCall;
  }

  const adContextPreviewDismissed =
    getBoolean(ctwaContext?.adContextPreviewDismissed) ??
    getBoolean(rawData.adContextPreviewDismissed);
  if (adContextPreviewDismissed !== undefined) {
    externalAdReply.adContextPreviewDismissed = adContextPreviewDismissed;
  }

  const sourceApp =
    getNonEmptyString(ctwaContext?.sourceApp) ??
    getNonEmptyString(rawData.sourceApp);
  if (sourceApp) externalAdReply.sourceApp = sourceApp;

  const automatedGreetingMessageShown =
    getBoolean(ctwaContext?.automatedGreetingMessageShown) ??
    getBoolean(rawData.automatedGreetingMessageShown);
  if (automatedGreetingMessageShown !== undefined) {
    externalAdReply.automatedGreetingMessageShown =
      automatedGreetingMessageShown;
  }

  const greetingMessageBody =
    getNonEmptyString(ctwaContext?.greetingMessageBody) ??
    getNonEmptyString(rawData.greetingMessageBody) ??
    getNonEmptyString(ctwaContext?.description) ??
    getNonEmptyString(rawData.description);
  if (greetingMessageBody) {
    externalAdReply.greetingMessageBody = greetingMessageBody;
  }

  const disableNudge =
    getBoolean(ctwaContext?.disableNudge) ?? getBoolean(rawData.disableNudge);
  if (disableNudge !== undefined) externalAdReply.disableNudge = disableNudge;

  const originalImageUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl);
  if (originalImageUrl) externalAdReply.originalImageUrl = originalImageUrl;

  const wtwaAdFormat =
    getBoolean(ctwaContext?.wtwaAdFormat) ?? getBoolean(rawData.wtwaAdFormat);
  if (wtwaAdFormat !== undefined) externalAdReply.wtwaAdFormat = wtwaAdFormat;

  return Object.keys(externalAdReply).length > 0 ? externalAdReply : undefined;
}

function buildAdsContextInfoFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const conversionData =
    getObjectRecord(ctwaContext?.conversionData) ??
    getObjectRecord(rawData.conversionData);

  const contextInfo: Record<string, unknown> = {};

  const conversionSource =
    getNonEmptyString(ctwaContext?.conversionSource) ??
    getNonEmptyString(rawData.conversionSource);
  if (conversionSource) contextInfo.conversionSource = conversionSource;

  const conversionDelaySeconds =
    getNumber(ctwaContext?.conversionDelaySeconds) ??
    getNumber(rawData.conversionDelaySeconds);
  if (conversionDelaySeconds !== undefined) {
    contextInfo.conversionDelaySeconds = conversionDelaySeconds;
  }

  const entryPointConversionSource =
    getNonEmptyString(ctwaContext?.entryPointConversionSource) ??
    getNonEmptyString(rawData.entryPointConversionSource);
  if (entryPointConversionSource) {
    contextInfo.entryPointConversionSource = entryPointConversionSource;
  }

  const entryPointConversionApp =
    getNonEmptyString(ctwaContext?.entryPointConversionApp) ??
    getNonEmptyString(rawData.entryPointConversionApp);
  if (entryPointConversionApp) {
    contextInfo.entryPointConversionApp = entryPointConversionApp;
  }

  const entryPointConversionDelaySeconds =
    getNumber(ctwaContext?.entryPointConversionDelaySeconds) ??
    getNumber(rawData.entryPointConversionDelaySeconds);
  if (entryPointConversionDelaySeconds !== undefined) {
    contextInfo.entryPointConversionDelaySeconds =
      entryPointConversionDelaySeconds;
  }

  const trustBannerAction =
    getNumber(ctwaContext?.trustBannerAction) ??
    getNumber(rawData.trustBannerAction);
  if (trustBannerAction !== undefined) {
    contextInfo.trustBannerAction = trustBannerAction;
  }

  const ctwaSignals =
    getNonEmptyString(ctwaContext?.ctwaSignals) ??
    getNonEmptyString(rawData.ctwaSignals) ??
    getJsonString(conversionData);
  if (ctwaSignals) {
    contextInfo.ctwaSignals = ctwaSignals;
  }

  const externalAdReply = buildExternalAdReplyFromRawData(rawData);
  if (externalAdReply) {
    contextInfo.externalAdReply = externalAdReply;
  }

  return Object.keys(contextInfo).length > 0 ? contextInfo : undefined;
}

function buildExtendedTextPreviewFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const extendedTextPreview: Record<string, unknown> = {};

  const matchedText =
    getNonEmptyString(rawData.matchedText) ??
    getNonEmptyString(ctwaContext?.sourceUrl) ??
    getNonEmptyString(rawData.sourceUrl);
  if (matchedText) {
    extendedTextPreview.matchedText = matchedText;
  }

  const title =
    getNonEmptyString(rawData.title) ?? getNonEmptyString(ctwaContext?.title);
  if (title) {
    extendedTextPreview.title = title;
  }

  const description =
    getNonEmptyString(rawData.description) ??
    getNonEmptyString(ctwaContext?.description);
  if (description) {
    extendedTextPreview.description = description;
  }

  const originalThumbnailUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl) ??
    getNonEmptyString(ctwaContext?.thumbnailUrl) ??
    getNonEmptyString(rawData.thumbnailUrl);
  if (originalThumbnailUrl) {
    extendedTextPreview.originalThumbnailUrl = originalThumbnailUrl;
  }

  if (!originalThumbnailUrl) {
    const jpegThumbnail =
      getNonEmptyString(rawData.thumbnail) ??
      getNonEmptyString(ctwaContext?.thumbnail);
    if (jpegThumbnail) {
      extendedTextPreview.jpegThumbnail = jpegThumbnail;
    }
  }

  const previewType =
    getNumber(rawData.previewType) ?? getNumber(rawData.richPreviewType);
  if (previewType !== undefined) {
    extendedTextPreview.previewType = previewType;
  }

  return Object.keys(extendedTextPreview).length > 0
    ? extendedTextPreview
    : undefined;
}

function mergeContextInfo(
  quoted?: Record<string, unknown>,
  forwarded?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!quoted && !forwarded) {
    return undefined;
  }

  return {
    ...(quoted ?? {}),
    ...(forwarded ?? {}),
  };
}

function getContextInfoTargetKey(
  rawType: string,
  messageType: EMessageType,
  innerMessage: Record<string, unknown>
): string | undefined {
  if (
    messageType === EMessageType.text ||
    messageType === EMessageType.system ||
    messageType === EMessageType.annotation
  ) {
    return 'extendedTextMessage';
  }

  const keyByRawType: Record<string, string> = {
    image: 'imageMessage',
    video: 'videoMessage',
    ptv: 'ptvMessage',
    ptt: 'audioMessage',
    audio: 'audioMessage',
    document: 'documentMessage',
    sticker: 'stickerMessage',
    location: 'locationMessage',
    vcard: 'contactMessage',
    contact: 'contactMessage',
    multi_vcard: 'contactsArrayMessage',
    contacts: 'contactsArrayMessage',
  };

  if (keyByRawType[rawType]) {
    return keyByRawType[rawType];
  }

  const knownContextKeys = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'ptvMessage',
    'documentMessage',
    'audioMessage',
    'stickerMessage',
    'locationMessage',
    'contactMessage',
    'contactsArrayMessage',
  ];

  for (const key of knownContextKeys) {
    if (getObjectRecord(innerMessage[key])) {
      return key;
    }
  }

  return undefined;
}

function attachContextInfo(
  innerMessage: Record<string, unknown>,
  contextInfo: Record<string, unknown>,
  rawType: string,
  messageType: EMessageType
): void {
  const targetKey = getContextInfoTargetKey(rawType, messageType, innerMessage);
  if (!targetKey) {
    return;
  }

  const currentTarget = getObjectRecord(innerMessage[targetKey]) ?? {};
  const currentContext = getObjectRecord(currentTarget.contextInfo) ?? {};

  innerMessage[targetKey] = {
    ...currentTarget,
    contextInfo: {
      ...currentContext,
      ...contextInfo,
    },
  };
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

  if (rawType === 'ptv') {
    return {
      ptvMessage: {
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
    const caption = getDocumentCaption(quoted);
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
  pushName?: string,
  pinEventData?: IWwebjsPinEventData
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
  const normalizedRemoteJid = normalizeJid(remoteJid) ?? remoteJid;

  if (
    normalizedRemoteJid === 'status@broadcast' ||
    normalizedRemoteJid.endsWith('@broadcast') ||
    normalizedRemoteJid.endsWith('@g.us') ||
    normalizedRemoteJid.endsWith('@newsletter')
  ) {
    return null;
  }

  const rawType = (msg.type ?? 'chat').toLowerCase();
  if (rawType === 'notification_template') {
    return null;
  }
  const rawData = getRawMessageData(msg);
  const ack = getNumber(msg.ack) ?? getNumber(rawData?.ack);
  const rawSubType = getNonEmptyString(rawData?.subtype)?.toLowerCase();
  const rawBody = typeof msg.body === 'string' ? msg.body : '';
  let body = resolveMessageBody(rawType, rawBody, rawData);
  let messageType = mapWwebjsTypeToMessageType(rawType, rawData);
  const pinInChatMessage = buildPinInChatMessage(
    rawType,
    rawData,
    pinEventData
  );
  const disappearingProtocolMessage = buildDisappearingProtocolMessage(
    rawType,
    rawData
  );
  if (pinInChatMessage) {
    messageType = EMessageType.system;
  }
  if (disappearingProtocolMessage) {
    messageType = EMessageType.set_disappearing_messages;
  }
  const isViewOnceUnavailableFanout =
    rawType === 'ciphertext' &&
    (rawSubType === 'view_once_unavailable_fanout' ||
      rawSubType?.startsWith('view_once_unavailable_'));
  const isViewOnce =
    (msg as { isViewOnce?: boolean }).isViewOnce === true ||
    isViewOnceUnavailableFanout ||
    messageType === EMessageType.view_once;
  if (isViewOnce) {
    messageType = EMessageType.view_once;
  }

  if (!body) {
    const e2eNotificationBody = resolveE2ENotificationBody(rawType, rawSubType);
    if (e2eNotificationBody) {
      body = e2eNotificationBody;
    }
  }
  if (!body) {
    const ciphertextFallbackBody = resolveCiphertextFallbackBody(
      rawType,
      rawSubType
    );
    if (ciphertextFallbackBody) {
      body = ciphertextFallbackBody;
    }
  }

  const innerMessage: Record<string, unknown> = {};
  if (messageType === EMessageType.text && body) {
    const extendedTextPreview = buildExtendedTextPreviewFromRawData(rawData);
    innerMessage.conversation = body;
    innerMessage.extendedTextMessage = {
      text: body,
      ...(extendedTextPreview ?? {}),
    };
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
  const contactPayload = buildContactPayload(msg, rawType, rawBody);
  if (contactPayload) {
    Object.assign(innerMessage, contactPayload);
  }
  if (pinInChatMessage) {
    innerMessage.pinInChatMessage = pinInChatMessage;
  }
  if (disappearingProtocolMessage) {
    Object.assign(innerMessage, disappearingProtocolMessage);
  }

  const quotedContextInfo = await buildQuotedContextInfo(msg);
  const forwardedContextInfo = buildForwardedContextInfo(msg);
  const adsContextInfo = buildAdsContextInfoFromRawData(rawData);
  const contextInfo = mergeContextInfo(
    mergeContextInfo(quotedContextInfo, forwardedContextInfo),
    adsContextInfo
  );
  if (contextInfo) {
    attachContextInfo(innerMessage, contextInfo, rawType, messageType);
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

  const resolvedPushName =
    pushName ?? (msg.fromMe ? undefined : getNotifyNameFromMessage(msg));

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
    pushName: resolvedPushName,
    ack,
  };

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: messageType,
    message: envelope,
    has_quoted: (msg.hasQuotedMsg ?? false) || !!quotedContextInfo,
  };
}
