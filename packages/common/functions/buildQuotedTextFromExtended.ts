import { WAMessage } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { IQuotedMessage } from '../interfaces/IChatMessage';
import { remoteJid } from './remoteJid';
import { remoteParticipantJid } from './remoteParticipantJid';
import { EMessageType } from '../enums/EMessageType';

export function buildQuotedTextFromExtended(
  m: WAMessage
): IQuotedMessage | null {
  const ext = m?.message?.extendedTextMessage;
  const ctx = ext?.contextInfo;

  if (!ctx?.stanzaId || !ctx?.quotedMessage || !m?.key?.remoteJid) {
    return null;
  }

  const rJid = remoteJid(m?.key);
  const participant = remoteParticipantJid(m?.key);

  const text =
    ctx?.quotedMessage?.conversation ??
    ctx?.quotedMessage?.extendedTextMessage?.text ??
    ctx?.quotedMessage?.buttonsMessage?.contentText ??
    ctx?.quotedMessage?.listMessage?.description ??
    '';

  const imageMessage = ctx?.quotedMessage?.imageMessage;
  const documentMessage = ctx?.quotedMessage?.documentMessage;
  let type = EMessageType.text;
  if (documentMessage) {
    type = EMessageType.document;
  } else if (imageMessage) {
    type = EMessageType.image;
  }

  const quoted: IQuotedMessage = {
    key: {
      remote_jid: rJid,
      remote_jid_alt: m.key?.remoteJidAlt ?? undefined,
      from_me: m.key?.fromMe ?? false,
      id: ctx.stanzaId,
      participant,
      participant_alt: m.key?.participantAlt ?? undefined,
      addressing_mode: m.key?.addressingMode ?? undefined,
      is_view_once: m.key?.isViewOnce ?? false,
    },
    message: text || null,
    type,
  };

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
