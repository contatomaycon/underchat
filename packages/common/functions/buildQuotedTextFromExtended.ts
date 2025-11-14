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
  if (!message) {
    return null;
  }

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

  let type = EMessageType.text;
  if (quotedMessage.documentMessage) {
    type = EMessageType.document;
  } else if (quotedMessage.imageMessage) {
    type = EMessageType.image;
  }

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

  return quoted;
}
