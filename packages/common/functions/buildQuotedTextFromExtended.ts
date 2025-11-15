import { WAMessage } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { IQuotedMessage } from '../interfaces/IChatMessage';
import { remoteJid } from './remoteJid';
import { remoteParticipantJid } from './remoteParticipantJid';
import { EMessageType } from '../enums/EMessageType';

function createThumbnail(jpegThumbnail?: Uint8Array | null): string | null {
  if (!jpegThumbnail || jpegThumbnail.length === 0) {
    return null;
  }
  return `data:image/jpeg;base64,${Buffer.from(jpegThumbnail).toString('base64')}`;
}

function determineMessageType(quotedMessage: any): EMessageType {
  if (quotedMessage.documentMessage) return EMessageType.document;
  if (quotedMessage.videoMessage) return EMessageType.video;
  if (quotedMessage.imageMessage) return EMessageType.image;
  if (quotedMessage.audioMessage) return EMessageType.audio;
  return EMessageType.text;
}

function extractText(quotedMessage: any): string {
  return (
    quotedMessage.conversation ??
    quotedMessage.extendedTextMessage?.text ??
    quotedMessage.buttonsMessage?.contentText ??
    quotedMessage.listMessage?.description ??
    quotedMessage.documentMessage?.caption ??
    quotedMessage.imageMessage?.caption ??
    ''
  );
}

function processImageMessage(quotedMessage: any, quoted: IQuotedMessage): void {
  const imageMessage = quotedMessage.imageMessage;
  if (!imageMessage) return;

  const thumbnail = createThumbnail(imageMessage.jpegThumbnail);

  quoted.image = {
    url: null,
    caption: imageMessage.caption ?? null,
    mimetype: imageMessage.mimetype ?? null,
    extension: null,
    size: imageMessage.fileLength
      ? Number(imageMessage.fileLength.toString())
      : null,
    height: imageMessage.height ?? null,
    width: imageMessage.width ?? null,
    thumbnail,
  };

  if (!quoted.message && imageMessage.caption) {
    quoted.message = imageMessage.caption;
  }
}

function processVideoMessage(quotedMessage: any, quoted: IQuotedMessage): void {
  const videoMessage = quotedMessage.videoMessage;
  if (!videoMessage) return;

  const thumbnail = createThumbnail(videoMessage.jpegThumbnail);

  quoted.video = {
    url: null,
    caption: videoMessage.caption ?? null,
    name: videoMessage.fileName ?? null,
    mimetype: videoMessage.mimetype ?? null,
    extension: null,
    size: videoMessage.fileLength
      ? Number(videoMessage.fileLength.toString())
      : null,
    duration: videoMessage.seconds ?? null,
    height: videoMessage.height ?? null,
    width: videoMessage.width ?? null,
    thumbnail,
  };

  if (!quoted.message && videoMessage.caption) {
    quoted.message = videoMessage.caption;
  }
}

function processDocumentMessage(
  quotedMessage: any,
  quoted: IQuotedMessage
): void {
  const documentMessage = quotedMessage.documentMessage;
  if (!documentMessage) return;

  quoted.document = {
    url: null,
    name: documentMessage.fileName ?? null,
    mimetype: documentMessage.mimetype ?? null,
    extension: null,
    size: documentMessage.fileLength
      ? Number(documentMessage.fileLength.toString())
      : null,
  };

  if (!quoted.message && documentMessage.fileName) {
    quoted.message = documentMessage.fileName;
  }
}

function processAudioMessage(quotedMessage: any, quoted: IQuotedMessage): void {
  const audioMessage = quotedMessage.audioMessage;
  if (!audioMessage) return;

  quoted.audio = {
    url: null,
    name: (audioMessage as any).fileName ?? null,
    mimetype: audioMessage.mimetype ?? null,
    extension: null,
    size: audioMessage.fileLength
      ? Number(audioMessage.fileLength.toString())
      : null,
    duration: audioMessage.seconds ?? null,
    ptt: audioMessage.ptt ?? false,
    view_once: false,
  };
}

export function buildQuotedTextFromExtended(
  m: WAMessage
): IQuotedMessage | null {
  const message = m?.message;
  if (!message) return null;

  const contextSources = [
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.documentMessage?.contextInfo,
    message.audioMessage?.contextInfo,
    message.stickerMessage?.contextInfo,
    (message as any).buttonsMessage?.contextInfo,
    (message as any).templateButtonReplyMessage?.contextInfo,
    (message as any).interactiveResponseMessage?.contextInfo,
  ];

  const ctx = contextSources.find((context) => context?.quotedMessage);

  if (!ctx?.stanzaId || !ctx?.quotedMessage || !m?.key?.remoteJid) {
    return null;
  }

  const quotedMessage = ctx.quotedMessage as any;
  const rJid = remoteJid(m?.key);
  const participant = ctx.participant ?? remoteParticipantJid(m?.key);
  const text = extractText(quotedMessage);
  const type = determineMessageType(quotedMessage);

  const quoted: IQuotedMessage = {
    key: {
      remote_jid: rJid,
      remote_jid_alt: m.key?.remoteJidAlt ?? undefined,
      from_me: ctx.participant
        ? ctx.participant === m.key?.participant
        : (m.key?.fromMe ?? false),
      id: ctx.stanzaId,
      participant,
      participant_alt: m.key?.participantAlt ?? undefined,
      addressing_mode: m.key?.addressingMode ?? undefined,
      is_view_once: m.key?.isViewOnce ?? false,
    },
    message: text || null,
    type,
  };

  processImageMessage(quotedMessage, quoted);
  processVideoMessage(quotedMessage, quoted);
  processDocumentMessage(quotedMessage, quoted);
  processAudioMessage(quotedMessage, quoted);

  return quoted;
}
