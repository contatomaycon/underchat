import { proto, WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { remoteJid } from './remoteJid';
import { IMapCtx } from '../interfaces/IMapCtx';

function getText(msg: proto.IMessage): string {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if ((msg as any).templateMessage?.hydratedTemplate?.hydratedContentText)
    return (msg as any).templateMessage.hydratedTemplate.hydratedContentText;
  if ((msg as any).ephemeralMessage?.message)
    return getText((msg as any).ephemeralMessage.message as proto.IMessage);

  return '';
}

function hasQuotedRecursive(msg: proto.IMessage): boolean {
  const contextSources = [
    msg.extendedTextMessage,
    msg.imageMessage,
    msg.videoMessage,
    msg.ptvMessage,
    msg.audioMessage,
    msg.documentMessage,
    msg.stickerMessage,
    msg.buttonsMessage,
    msg.templateButtonReplyMessage,
    msg.interactiveResponseMessage,
  ]
    .map((entry) => entry?.contextInfo)
    .filter(Boolean);

  if (contextSources.some((ctx) => ctx?.quotedMessage)) return true;

  if (msg.ephemeralMessage?.message)
    return hasQuotedRecursive(msg.ephemeralMessage.message as proto.IMessage);

  return false;
}

function getViewOnceInner(msg: proto.IMessage): proto.IMessage | undefined {
  const v1 = msg.viewOnceMessage?.message as proto.IMessage | undefined;
  const v2 = msg.viewOnceMessageV2?.message as proto.IMessage | undefined;
  const v3 = msg.viewOnceMessageV2Extension?.message as
    | proto.IMessage
    | undefined;

  return v1 || v2 || v3;
}

function unwrapMessage(msg: proto.IMessage): proto.IMessage {
  const ephemeral = msg.ephemeralMessage?.message as proto.IMessage | undefined;
  if (ephemeral) return unwrapMessage(ephemeral);

  const viewOnce = msg.viewOnceMessage?.message as proto.IMessage | undefined;
  if (viewOnce) return unwrapMessage(viewOnce);

  const viewOnceV2 = msg.viewOnceMessageV2?.message as
    | proto.IMessage
    | undefined;
  if (viewOnceV2) return unwrapMessage(viewOnceV2);

  const viewOnceV2Ext = msg.viewOnceMessageV2Extension?.message as
    | proto.IMessage
    | undefined;
  if (viewOnceV2Ext) return unwrapMessage(viewOnceV2Ext);

  const documentWithCaption = (msg as any).documentWithCaptionMessage
    ?.message as proto.IMessage | undefined;
  if (documentWithCaption) return unwrapMessage(documentWithCaption);

  const imageWithCaption = (msg as any).imageWithCaptionMessage?.message as
    | proto.IMessage
    | undefined;
  if (imageWithCaption) return unwrapMessage(imageWithCaption);

  const videoWithCaption = (msg as any).videoWithCaptionMessage?.message as
    | proto.IMessage
    | undefined;
  if (videoWithCaption) return unwrapMessage(videoWithCaption);

  return msg;
}

function detectReactionOrPin({ msg }: IMapCtx): EMessageType | undefined {
  const unwrapped = unwrapMessage(msg);
  if (unwrapped.reactionMessage) return EMessageType.react;
  if ((unwrapped as any).encReactionMessage) return EMessageType.react;
  if ((msg as any).pinInChatMessage) return EMessageType.system;
  if ((unwrapped as any).pinInChatMessage) return EMessageType.system;
}

function detectMedia({ msg }: IMapCtx): EMessageType | undefined {
  const unwrapped = unwrapMessage(msg);
  if (msg.imageMessage || unwrapped.imageMessage) return EMessageType.image;
  if (msg.ptvMessage || unwrapped.ptvMessage) return EMessageType.video_note;
  if (msg.videoMessage || unwrapped.videoMessage) return EMessageType.video;
  if (msg.audioMessage || unwrapped.audioMessage) return EMessageType.audio;
  if (msg.stickerMessage || unwrapped.stickerMessage)
    return EMessageType.sticker;
  if (msg.documentMessage || unwrapped.documentMessage)
    return EMessageType.document;
  if (msg.locationMessage || unwrapped.locationMessage)
    return EMessageType.location;
  if (msg.contactMessage || unwrapped.contactMessage)
    return EMessageType.contact_card;
  if (msg.contactsArrayMessage || unwrapped.contactsArrayMessage)
    return EMessageType.contacts;
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

function detectTemplate({ msg }: IMapCtx): EMessageType | undefined {
  const templateMsg = (msg as any).templateMessage;
  if (templateMsg?.hydratedTemplate) {
    return EMessageType.text;
  }

  const unwrapped = unwrapMessage(msg);
  const unwrappedTemplate = (unwrapped as any).templateMessage;
  if (unwrappedTemplate?.hydratedTemplate) {
    return EMessageType.text;
  }

  return undefined;
}

function detectText({ text, msg }: IMapCtx): EMessageType | undefined {
  if (text) return EMessageType.text;

  if (msg.extendedTextMessage || msg.conversation !== undefined) {
    return EMessageType.text;
  }

  const unwrapped = unwrapMessage(msg);
  if (unwrapped.extendedTextMessage || unwrapped.conversation !== undefined) {
    return EMessageType.text;
  }

  return undefined;
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
    detectTemplate,
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
