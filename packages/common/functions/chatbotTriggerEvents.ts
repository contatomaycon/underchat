import { proto } from '@whiskeysockets/baileys';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { unwrapMessage } from '@core/common/functions/unwrapMessage';

export const CHATBOT_TRIGGER_EVENT_VALUES = [
  'text',
  'audio',
  'attachments',
  'reactions',
  'gifs',
] as const;

export type ChatbotTriggerEvent = (typeof CHATBOT_TRIGGER_EVENT_VALUES)[number];

const CHATBOT_TRIGGER_EVENT_SET = new Set<string>(CHATBOT_TRIGGER_EVENT_VALUES);
const EMOJI_GRAPHEME_SEGMENTER = new Intl.Segmenter('en', {
  granularity: 'grapheme',
});

const ATTACHMENT_TYPES = new Set<EMessageType>([
  EMessageType.image,
  EMessageType.video,
  EMessageType.video_note,
  EMessageType.document,
  EMessageType.location,
  EMessageType.contact_card,
  EMessageType.contacts,
  EMessageType.view_once,
]);

function normalizeMimetype(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isGifMimetype(value: unknown): boolean {
  const normalized = normalizeMimetype(value);
  if (!normalized) {
    return false;
  }

  return normalized.includes('gif');
}

function getInnerMessage(data: IUpsertMessage): proto.IMessage | undefined {
  const message = data.message?.message as proto.IMessage | undefined;
  if (!message) {
    return undefined;
  }

  return unwrapMessage(message) ?? message;
}

function getImageMimetype(
  data: IUpsertMessage,
  message: proto.IMessage | undefined
): string | null {
  return (
    normalizeMimetype(data.content?.image?.mimetype) ??
    normalizeMimetype(message?.imageMessage?.mimetype)
  );
}

function getVideoMimetype(
  data: IUpsertMessage,
  message: proto.IMessage | undefined
): string | null {
  return (
    normalizeMimetype(data.content?.video?.mimetype) ??
    normalizeMimetype(message?.videoMessage?.mimetype) ??
    normalizeMimetype(message?.ptvMessage?.mimetype)
  );
}

function hasVideoGifPlayback(
  data: IUpsertMessage,
  message: proto.IMessage | undefined
): boolean {
  if (isGifMimetype(data.content?.video?.mimetype)) {
    return true;
  }

  return (
    Boolean(message?.videoMessage?.gifPlayback) ||
    Boolean(message?.ptvMessage?.gifPlayback)
  );
}

function isGifTriggerEvent(data: IUpsertMessage): boolean {
  const message = getInnerMessage(data);
  const hasImageMessage = Boolean(message?.imageMessage);
  const hasVideoMessage = Boolean(message?.videoMessage || message?.ptvMessage);

  if (data.type === EMessageType.image || hasImageMessage) {
    return isGifMimetype(getImageMimetype(data, message));
  }

  if (
    data.type === EMessageType.video ||
    data.type === EMessageType.video_note ||
    hasVideoMessage
  ) {
    if (hasVideoGifPlayback(data, message)) {
      return true;
    }

    return isGifMimetype(getVideoMimetype(data, message));
  }

  return false;
}

function getTextContent(data: IUpsertMessage): string | null {
  if (typeof data.content?.message === 'string' && data.content.message.trim()) {
    return data.content.message;
  }

  const message = getInnerMessage(data);
  if (typeof message?.extendedTextMessage?.text === 'string') {
    const text = message.extendedTextMessage.text.trim();
    if (text) return text;
  }

  if (typeof message?.conversation === 'string') {
    const text = message.conversation.trim();
    if (text) return text;
  }

  return null;
}

function isEmojiOnlyKeycap(value: string): boolean {
  return /^(?:[#*0-9]\uFE0F?\u20E3)$/u.test(value);
}

function isEmojiOnlyFlag(value: string): boolean {
  return /^(?:[\u{1F1E6}-\u{1F1FF}]{2})$/u.test(value);
}

function isEmojiGrapheme(value: string): boolean {
  if (isEmojiOnlyKeycap(value) || isEmojiOnlyFlag(value)) {
    return true;
  }

  const normalized = value
    .replace(/[\u200D\uFE0E\uFE0F]/gu, '')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');

  if (!normalized) {
    return false;
  }

  if (!/\p{Extended_Pictographic}/u.test(normalized)) {
    return false;
  }

  const remainder = normalized.replace(/\p{Extended_Pictographic}/gu, '');
  return remainder.length === 0;
}

function isEmojiOnlyTextEvent(data: IUpsertMessage): boolean {
  if (data.type !== EMessageType.text) {
    return false;
  }

  const text = getTextContent(data);
  if (!text) {
    return false;
  }

  const graphemes = Array.from(
    EMOJI_GRAPHEME_SEGMENTER.segment(text),
    (entry) => entry.segment
  ).filter((segment) => !/^\s+$/u.test(segment));

  if (!graphemes.length) {
    return false;
  }

  return graphemes.every(isEmojiGrapheme);
}

export function classifyChatbotTriggerEvent(
  data: IUpsertMessage
): ChatbotTriggerEvent | null {
  if (isEmojiOnlyTextEvent(data)) {
    return 'gifs';
  }

  if (data.type === EMessageType.text) {
    return 'text';
  }

  if (data.type === EMessageType.audio) {
    return 'audio';
  }

  if (data.type === EMessageType.react) {
    return 'reactions';
  }

  if (data.type === EMessageType.sticker) {
    return 'gifs';
  }

  if (isGifTriggerEvent(data)) {
    return 'gifs';
  }

  if (ATTACHMENT_TYPES.has(data.type)) {
    return 'attachments';
  }

  return null;
}

export function normalizeChatbotTriggerEvents(
  triggerEvents: string[] | null | undefined
): Set<ChatbotTriggerEvent> | null {
  if (triggerEvents === undefined || triggerEvents === null) {
    return null;
  }

  return new Set<ChatbotTriggerEvent>(
    triggerEvents.filter((event): event is ChatbotTriggerEvent =>
      CHATBOT_TRIGGER_EVENT_SET.has(event)
    )
  );
}

export function isChatbotTriggerEventEnabled(
  triggerEvent: ChatbotTriggerEvent | null,
  triggerEvents: string[] | null | undefined
): boolean {
  if (!triggerEvent) {
    return false;
  }

  const normalizedEvents = normalizeChatbotTriggerEvents(triggerEvents);
  if (!normalizedEvents) {
    return true;
  }

  return normalizedEvents.has(triggerEvent);
}
