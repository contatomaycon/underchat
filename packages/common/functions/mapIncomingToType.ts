import { proto, WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { remoteJid } from './remoteJid';
import { IMapCtx } from '../interfaces/IMapCtx';

function getText(msg: proto.IMessage): string {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if ((msg as any).ephemeralMessage?.message)
    return getText((msg as any).ephemeralMessage.message as proto.IMessage);

  return '';
}

function hasQuotedRecursive(msg: proto.IMessage): boolean {
  const contextSources = [
    msg.extendedTextMessage,
    msg.imageMessage,
    msg.videoMessage,
    msg.audioMessage,
    msg.documentMessage,
    msg.stickerMessage,
    (msg as any).buttonsMessage,
    (msg as any).templateButtonReplyMessage,
    (msg as any).interactiveResponseMessage,
  ]
    .map((entry) => entry?.contextInfo)
    .filter(Boolean);

  if (contextSources.some((ctx) => ctx?.quotedMessage)) return true;

  if ((msg as any).ephemeralMessage?.message)
    return hasQuotedRecursive(
      (msg as any).ephemeralMessage.message as proto.IMessage
    );

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

function detectReactionOrPin({ msg }: IMapCtx): EMessageType | undefined {
  if (msg.reactionMessage) return EMessageType.react;
}

function detectMedia({ msg }: IMapCtx): EMessageType | undefined {
  if (msg.imageMessage) return EMessageType.image;
  if (msg.videoMessage) return EMessageType.video;
  if (msg.audioMessage) return EMessageType.audio;
  if (msg.stickerMessage) return EMessageType.sticker;
  if (msg.documentMessage) return EMessageType.document;
  if (msg.locationMessage) return EMessageType.location;
  if (msg.contactMessage) return EMessageType.contact_card;
  if (msg.contactsArrayMessage) return EMessageType.contacts;
}

function detectProtocol({ pType, msg }: IMapCtx): EMessageType | undefined {
  const T = proto.Message.ProtocolMessage.Type;
  if (pType === T.REVOKE) return EMessageType.delete_message;
  if (pType === T.MESSAGE_EDIT) return EMessageType.edit_text;
  if (
    pType === T.EPHEMERAL_SETTING ||
    (msg as any).disappearingMessagesInChat !== undefined
  )
    return EMessageType.set_disappearing_messages;
}

function detectText({ text, msg }: IMapCtx): EMessageType | undefined {
  if (!text) return;

  return EMessageType.text;
}

export function mapIncomingToType(m: WAMessage): EMessageType | undefined {
  if (m.key?.isViewOnce === true) return EMessageType.view_once;

  const msg = m.message as proto.IMessage | undefined;
  if (!msg) return;

  if (
    (m.message as any).editedMessage?.message?.protocolMessage?.type ===
    proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
  ) {
    return EMessageType.edit_text;
  }

  const ctx: IMapCtx = {
    msg,
    text: getText(msg),
    vOnce: getViewOnceInner(msg),
    isStatus: remoteJid(m.key) === 'status@broadcast',
    pType: msg.protocolMessage?.type ?? undefined,
  };

  const detectors = [
    detectReactionOrPin,
    detectMedia,
    detectProtocol,
    detectText,
  ];

  for (const detect of detectors) {
    const t = detect(ctx);
    if (t) return t;
  }
}

export function messageHasQuoted(m: WAMessage): boolean {
  const msg = m.message as proto.IMessage | undefined;
  if (!msg) return false;
  return hasQuotedRecursive(msg);
}
