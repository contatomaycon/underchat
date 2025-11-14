import { WAMessage } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { IQuotedMessage } from '../interfaces/IChatMessage';
import { remoteJid } from './remoteJid';
import { remoteParticipantJid } from './remoteParticipantJid';
import { EMessageType } from '../enums/EMessageType';

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

  const text =
    quotedMessage.conversation ??
    quotedMessage.extendedTextMessage?.text ??
    quotedMessage.buttonsMessage?.contentText ??
    quotedMessage.listMessage?.description ??
    quotedMessage.documentMessage?.caption ??
    quotedMessage.imageMessage?.caption ??
    '';

  const hasDocument = !!quotedMessage.documentMessage;
  const hasVideo = !!quotedMessage.videoMessage;
  const hasImage = !!quotedMessage.imageMessage;
  const hasAudio = !!quotedMessage.audioMessage;

  let type = EMessageType.text;
  if (hasDocument) type = EMessageType.document;
  if (!hasDocument && hasVideo) type = EMessageType.video;
  if (!hasDocument && !hasVideo && hasImage) type = EMessageType.image;
  if (!hasDocument && !hasVideo && !hasImage && hasAudio)
    type = EMessageType.audio;

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

  const imageMessage = quotedMessage.imageMessage;
  if (imageMessage) {
    const thumbnail =
      imageMessage.jpegThumbnail && imageMessage.jpegThumbnail.length > 0
        ? `data:image/jpeg;base64,${Buffer.from(
            imageMessage.jpegThumbnail
          ).toString('base64')}`
        : null;

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

  const videoMessage = quotedMessage.videoMessage;
  if (videoMessage) {
    const thumbnail =
      videoMessage.jpegThumbnail && videoMessage.jpegThumbnail.length > 0
        ? `data:image/jpeg;base64,${Buffer.from(
            videoMessage.jpegThumbnail
          ).toString('base64')}`
        : null;

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

  const documentMessage = quotedMessage.documentMessage;
  if (documentMessage) {
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

  const audioMessage = quotedMessage.audioMessage;
  if (audioMessage) {
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

  return quoted;
}
