import { WAMessage } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import type {
  IButtonMessage,
  IListMessage,
  IQuotedMessage,
} from '../interfaces/IChatMessage';
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
  if (quotedMessage.ptvMessage) return EMessageType.video_note;
  if (quotedMessage.videoMessage) return EMessageType.video;
  if (quotedMessage.imageMessage) return EMessageType.image;
  if (quotedMessage.audioMessage) return EMessageType.audio;
  if (quotedMessage.stickerMessage) return EMessageType.sticker;
  if (quotedMessage.locationMessage) return EMessageType.location;
  if (quotedMessage.contactMessage) return EMessageType.contact_card;
  return EMessageType.text;
}

function extractText(quotedMessage: any): string {
  return (
    quotedMessage.conversation ??
    quotedMessage.extendedTextMessage?.text ??
    quotedMessage.buttonsMessage?.contentText ??
    quotedMessage.buttonsResponseMessage?.selectedDisplayText ??
    quotedMessage.listMessage?.description ??
    quotedMessage.listResponseMessage?.title ??
    quotedMessage.documentMessage?.caption ??
    quotedMessage.imageMessage?.caption ??
    ''
  );
}

function normalizeButtonType(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeButtonId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getButtonDisplayText(button: any): string | null {
  const value =
    button?.buttonText?.displayText ??
    button?.buttonText?.text ??
    button?.displayText ??
    button?.text ??
    button?.title;

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildButtonsContent(quotedMessage: any): IButtonMessage | null {
  const buttonsMessage = quotedMessage?.buttonsMessage;
  if (!buttonsMessage || !Array.isArray(buttonsMessage.buttons)) {
    return null;
  }

  const buttons = buttonsMessage.buttons
    .map((button: any) => {
      const displayText = getButtonDisplayText(button);
      if (!displayText) return null;

      return {
        id: normalizeButtonId(
          button?.buttonId ?? button?.buttonID ?? button?.id
        ),
        display_text: displayText,
        type: normalizeButtonType(button?.type),
      };
    })
    .filter(
      (
        button: {
          id: string | null;
          display_text: string;
          type: string | number | null;
        } | null
      ): button is {
        id: string | null;
        display_text: string;
        type: string | number | null;
      } => button !== null
    );

  if (!buttons.length) {
    return null;
  }

  return {
    text: buttonsMessage.contentText ?? buttonsMessage.text ?? null,
    footer: buttonsMessage.footerText ?? buttonsMessage.footer ?? null,
    header: buttonsMessage.headerText ?? buttonsMessage.header ?? null,
    header_type: normalizeButtonType(buttonsMessage.headerType),
    buttons,
  };
}

function getListRowTitle(row: any): string | null {
  const value =
    row?.title ??
    row?.name ??
    row?.text ??
    row?.displayText ??
    row?.rowId ??
    row?.rowID ??
    row?.id;

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeListRowId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildListContent(quotedMessage: any): IListMessage | null {
  const listMessage = quotedMessage?.listMessage;
  if (!listMessage || !Array.isArray(listMessage.sections)) {
    return null;
  }

  const sections = listMessage.sections
    .map((section: any, sectionIndex: number) => {
      const rows = Array.isArray(section?.rows) ? section.rows : [];
      const normalizedRows = rows
        .map((row: any) => {
          const title = getListRowTitle(row);
          if (!title) return null;

          return {
            id: normalizeListRowId(row?.rowId ?? row?.rowID ?? row?.id),
            title,
            description:
              typeof row?.description === 'string' &&
              row.description.trim().length > 0
                ? row.description.trim()
                : null,
          };
        })
        .filter(
          (
            row: {
              id: string | null;
              title: string;
              description: string | null;
            } | null
          ): row is {
            id: string | null;
            title: string;
            description: string | null;
          } => row !== null
        );

      if (!normalizedRows.length) return null;

      return {
        id:
          normalizeListRowId(section?.id ?? section?.sectionId) ??
          `section-${sectionIndex + 1}`,
        title:
          typeof section?.title === 'string' && section.title.trim().length > 0
            ? section.title.trim()
            : null,
        rows: normalizedRows,
      };
    })
    .filter(
      (
        section: {
          id: string | null;
          title: string | null;
          rows: IListMessage['sections'][number]['rows'];
        } | null
      ): section is {
        id: string | null;
        title: string | null;
        rows: IListMessage['sections'][number]['rows'];
      } => section !== null
    );

  if (!sections.length) {
    return null;
  }

  return {
    text: listMessage.description ?? listMessage.text ?? null,
    button_text: listMessage.buttonText ?? listMessage.button_text ?? null,
    list_type: normalizeButtonType(listMessage.listType),
    sections,
  };
}

function processButtonsMessage(
  quotedMessage: any,
  quoted: IQuotedMessage
): void {
  const buttons = buildButtonsContent(quotedMessage);
  if (!buttons) return;

  quoted.buttons = buttons;
  if (!quoted.message && buttons.text) {
    quoted.message = buttons.text;
  }
}

function processListMessage(quotedMessage: any, quoted: IQuotedMessage): void {
  const list = buildListContent(quotedMessage);
  if (!list) return;

  quoted.list = list;
  if (!quoted.message && list.text) {
    quoted.message = list.text;
  }
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
  const videoMessage = quotedMessage.videoMessage ?? quotedMessage.ptvMessage;
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
}

function processAudioMessage(quotedMessage: any, quoted: IQuotedMessage): void {
  const audioMessage = quotedMessage.audioMessage;
  if (!audioMessage) return;

  quoted.audio = {
    url: null,
    name: audioMessage.fileName ?? null,
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

function processStickerMessage(
  quotedMessage: any,
  quoted: IQuotedMessage
): void {
  const stickerMessage = quotedMessage.stickerMessage;
  if (!stickerMessage) return;

  quoted.sticker = {
    url: null,
    mimetype: stickerMessage.mimetype ?? null,
    extension: null,
    size: stickerMessage.fileLength
      ? Number(stickerMessage.fileLength.toString())
      : null,
    height: stickerMessage.height ?? null,
    width: stickerMessage.width ?? null,
    is_animated: stickerMessage.isAnimated ?? false,
  };
}

function processLocationMessage(
  quotedMessage: any,
  quoted: IQuotedMessage
): void {
  const locationMessage = quotedMessage.locationMessage;
  if (!locationMessage) return;

  quoted.location = {
    latitude: locationMessage.degreesLatitude ?? null,
    longitude: locationMessage.degreesLongitude ?? null,
    name: locationMessage.name ?? null,
    address: locationMessage.address ?? null,
  };

  if (!quoted.message && locationMessage.name) {
    quoted.message = locationMessage.name;
  } else if (!quoted.message && locationMessage.address) {
    quoted.message = locationMessage.address;
  }
}

function processContactMessage(
  quotedMessage: any,
  quoted: IQuotedMessage
): void {
  const contactMessage = quotedMessage.contactMessage;
  if (!contactMessage?.vcard) return;

  const vcard = contactMessage.vcard;
  const nameMatch = vcard.match(/FN:([^\r\n]+)/);
  const telMatch = vcard.match(/TEL:([^\r\n]+)/);
  const emailMatch = vcard.match(/EMAIL:([^\r\n]+)/);

  const fullName = nameMatch?.[1]?.trim() || '';
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || null;
  const phone = telMatch?.[1]?.trim() || null;

  const contactId = `quoted_${Buffer.from(vcard).toString('base64').substring(0, 16)}`;

  quoted.contact = {
    contact_id: contactId,
    name: firstName || 'Contato',
    last_name: lastName,
    phone: phone,
    phone_partial: phone ? phone.replaceAll(/\D/g, '') : null,
    phone_ddi: null,
    email: emailMatch?.[1]?.trim() || null,
    email_partial: null,
  };

  if (!quoted.message && fullName) {
    quoted.message = fullName;
  } else if (!quoted.message && contactMessage.displayName) {
    quoted.message = contactMessage.displayName;
  }
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
    message.locationMessage?.contextInfo,
    message.contactMessage?.contextInfo,
    (message as any).contactsArrayMessage?.contextInfo,
    (message as any).buttonsMessage?.contextInfo,
    (message as any).buttonsResponseMessage?.contextInfo,
    (message as any).listMessage?.contextInfo,
    (message as any).listResponseMessage?.contextInfo,
    (message as any).templateButtonReplyMessage?.contextInfo,
    (message as any).interactiveResponseMessage?.contextInfo,
  ];

  const ctx = contextSources.find((context) => context?.quotedMessage);

  if (!ctx?.stanzaId || !ctx?.quotedMessage || !m?.key?.remoteJid) {
    return null;
  }

  const quotedMessage = ctx.quotedMessage;
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
  processStickerMessage(quotedMessage, quoted);
  processLocationMessage(quotedMessage, quoted);
  processContactMessage(quotedMessage, quoted);
  processButtonsMessage(quotedMessage, quoted);
  processListMessage(quotedMessage, quoted);

  return quoted;
}
