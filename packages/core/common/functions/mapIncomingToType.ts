import { proto, WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';

function getText(msg: proto.IMessage): string {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if ((msg as any).ephemeralMessage?.message)
    return getText((msg as any).ephemeralMessage.message as proto.IMessage);

  return '';
}

function hasQuoted(msg: proto.IMessage): boolean {
  if (msg.extendedTextMessage?.contextInfo?.quotedMessage) return true;
  if ((msg as any).ephemeralMessage?.message)
    return hasQuoted((msg as any).ephemeralMessage.message as proto.IMessage);

  return false;
}

function hasMentions(msg: proto.IMessage): boolean {
  const ctx = msg.extendedTextMessage?.contextInfo;

  if (ctx?.mentionedJid?.length) return true;
  if ((msg as any).ephemeralMessage?.message)
    return hasMentions((msg as any).ephemeralMessage.message as proto.IMessage);

  return false;
}

function getViewOnceInner(msg: proto.IMessage): proto.IMessage | undefined {
  const v1 = (msg as any).viewOnceMessage?.message as
    | proto.IMessage
    | undefined;
  const v2 = (msg as any).viewOnceMessageV2?.message as
    | proto.IMessage
    | undefined;
  const v3 = (msg as any).viewOnceMessageV2Extension?.message as
    | proto.IMessage
    | undefined;

  return v1 || v2 || v3;
}

export function mapIncomingToType(m: WAMessage): EMessageType | undefined {
  const msg = m.message as proto.IMessage | undefined;
  if (!msg) return;

  const remote = m.key?.remoteJid ?? '';
  const isStatus = remote === 'status@broadcast';

  const text = getText(msg);
  const vOnce = getViewOnceInner(msg);
  const ProtocolType = proto.Message.ProtocolMessage.Type;
  const pType = msg.protocolMessage?.type ?? undefined;

  if (msg.reactionMessage) return EMessageType.react;
  if ((msg as any).pinInChatMessage || (msg as any).pinInChat)
    return EMessageType.pin_message;

  if (isStatus) {
    if (msg.imageMessage || vOnce?.imageMessage)
      return EMessageType.status_image;
    if (msg.videoMessage || vOnce?.videoMessage)
      return EMessageType.status_video;
    if (text) return EMessageType.status_text;
  }

  if (vOnce?.imageMessage) return EMessageType.view_once_image;
  if (vOnce?.videoMessage) return EMessageType.view_once_video;

  if (msg.imageMessage) return EMessageType.image;
  if (msg.videoMessage) return EMessageType.video;
  if (msg.audioMessage) return EMessageType.audio;
  if (msg.stickerMessage) return EMessageType.sticker;
  if (msg.documentMessage) return EMessageType.document;
  if (msg.locationMessage) return EMessageType.location;
  if (msg.contactMessage) return EMessageType.contact_card;
  if (msg.contactsArrayMessage) return EMessageType.contacts;

  if (
    (msg as any).buttonsResponseMessage ||
    (msg as any).templateButtonReplyMessage
  )
    return EMessageType.button_reply;
  if (msg.listResponseMessage) return EMessageType.list_reply;

  if ((msg as any).pollCreationMessage) return EMessageType.poll;
  if ((msg as any).groupInviteMessage) return EMessageType.group_invite;
  if ((msg as any).productMessage) return EMessageType.product;

  if (pType === ProtocolType.REVOKE) return EMessageType.delete_message;
  if (pType === ProtocolType.MESSAGE_EDIT) return EMessageType.edit_text;
  if (
    pType === ProtocolType.EPHEMERAL_SETTING ||
    (msg as any).disappearingMessagesInChat !== undefined
  ) {
    return EMessageType.set_disappearing_messages;
  }

  if (text) {
    if (hasQuoted(msg)) return EMessageType.text_quoted;
    if (hasMentions(msg)) return EMessageType.mention;

    return EMessageType.text;
  }

  return;
}
