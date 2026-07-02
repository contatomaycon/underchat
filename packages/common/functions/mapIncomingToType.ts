import { proto, WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { remoteJid } from './remoteJid';
import { IMapCtx } from '../interfaces/IMapCtx';
import { unwrapMessage } from './unwrapMessage';

const VIEW_ONCE_UNAVAILABLE_TOKEN = 'view_once_unavailable';

function hasViewOnceUnavailableStub(m: WAMessage): boolean {
  if (m.messageStubType !== proto.WebMessageInfo.StubType.CIPHERTEXT) {
    return false;
  }

  const params = m.messageStubParameters;
  if (!Array.isArray(params) || !params.length) {
    return false;
  }

  return params.some(
    (value) =>
      typeof value === 'string' &&
      value.toLowerCase().includes(VIEW_ONCE_UNAVAILABLE_TOKEN)
  );
}

function getText(msg: proto.IMessage): string {
  const base = unwrapMessage(msg, { keepViewOnce: true }) ?? msg;

  if (base.conversation) return base.conversation;
  if (base.extendedTextMessage?.text) return base.extendedTextMessage.text;
  if (base.buttonsMessage?.contentText) return base.buttonsMessage.contentText;
  if ((base as any).buttonsResponseMessage?.selectedDisplayText)
    return (base as any).buttonsResponseMessage.selectedDisplayText;
  if ((base as any).listMessage?.description)
    return (base as any).listMessage.description;
  if ((base as any).listResponseMessage?.title)
    return (base as any).listResponseMessage.title;
  if ((base as any).templateMessage?.hydratedTemplate?.hydratedContentText)
    return (base as any).templateMessage.hydratedTemplate.hydratedContentText;

  return '';
}

function hasMeaningfulTextField(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.trim().length > 0;
}

function hasAlbumContainerOnly(msg: proto.IMessage): boolean {
  const base = unwrapMessage(msg, { keepViewOnce: true }) ?? msg;
  const albumMessage = (base as Record<string, unknown>).albumMessage;
  if (!albumMessage) return false;

  return (
    !base.imageMessage &&
    !base.videoMessage &&
    !base.ptvMessage &&
    !base.documentMessage &&
    !base.audioMessage &&
    !base.stickerMessage &&
    !hasMeaningfulTextField(base.conversation) &&
    !hasMeaningfulTextField(base.extendedTextMessage?.text)
  );
}

function hasQuotedRecursive(msg: proto.IMessage): boolean {
  const base = unwrapMessage(msg, { keepViewOnce: true }) ?? msg;

  const contextSources = [
    base.extendedTextMessage,
    base.imageMessage,
    base.videoMessage,
    base.ptvMessage,
    base.audioMessage,
    base.documentMessage,
    base.stickerMessage,
    base.buttonsMessage,
    (base as any).buttonsResponseMessage,
    (base as any).listMessage,
    (base as any).listResponseMessage,
    base.templateButtonReplyMessage,
    base.interactiveResponseMessage,
  ]
    .map((entry) => entry?.contextInfo)
    .filter(Boolean);

  if (contextSources.some((ctx) => ctx?.quotedMessage)) return true;

  return false;
}

function getViewOnceInner(msg: proto.IMessage): proto.IMessage | undefined {
  const v1 = msg.viewOnceMessage?.message as proto.IMessage | undefined;
  const v2 = msg.viewOnceMessageV2?.message as proto.IMessage | undefined;
  const v3 = msg.viewOnceMessageV2Extension?.message as
    proto.IMessage | undefined;

  return v1 || v2 || v3;
}

function detectReactionOrPin({ msg }: IMapCtx): EMessageType | undefined {
  const unwrapped = unwrapMessage(msg) ?? msg;
  if (unwrapped.reactionMessage) return EMessageType.react;
  if ((unwrapped as any).encReactionMessage) return EMessageType.react;
  if ((msg as any).pinInChatMessage) return EMessageType.system;
  if ((unwrapped as any).pinInChatMessage) return EMessageType.system;
}

function detectMedia({ msg }: IMapCtx): EMessageType | undefined {
  const unwrapped = unwrapMessage(msg) ?? msg;
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
    pType === T.EPHEMERAL_SYNC_RESPONSE ||
    (msg as any).disappearingMessagesInChat !== undefined
  )
    return EMessageType.set_disappearing_messages;
}

function detectTemplate({ msg }: IMapCtx): EMessageType | undefined {
  const templateMsg = (msg as any).templateMessage;
  if (templateMsg?.hydratedTemplate) {
    return EMessageType.text;
  }

  const unwrapped = unwrapMessage(msg) ?? msg;
  const unwrappedTemplate = (unwrapped as any).templateMessage;
  if (unwrappedTemplate?.hydratedTemplate) {
    return EMessageType.text;
  }

  return undefined;
}

function detectButtons({ msg }: IMapCtx): EMessageType | undefined {
  const base = unwrapMessage(msg) ?? msg;
  if (base.buttonsMessage || (base as any).buttonsResponseMessage) {
    return EMessageType.text;
  }

  return undefined;
}

function detectList({ msg }: IMapCtx): EMessageType | undefined {
  const base = unwrapMessage(msg) ?? msg;
  if ((base as any).listMessage || (base as any).listResponseMessage) {
    return EMessageType.text;
  }

  return undefined;
}

function detectText({ text, msg }: IMapCtx): EMessageType | undefined {
  if (text) return EMessageType.text;

  if (
    hasMeaningfulTextField(msg.extendedTextMessage?.text) ||
    hasMeaningfulTextField(msg.conversation)
  ) {
    return EMessageType.text;
  }

  const unwrapped = unwrapMessage(msg) ?? msg;
  if (
    hasMeaningfulTextField(unwrapped.extendedTextMessage?.text) ||
    hasMeaningfulTextField(unwrapped.conversation)
  ) {
    return EMessageType.text;
  }

  return undefined;
}

export function mapIncomingToType(m: WAMessage): EMessageType | undefined {
  if (hasViewOnceUnavailableStub(m)) return EMessageType.view_once;
  if (m.key?.isViewOnce === true) return EMessageType.view_once;

  const msg = m.message as proto.IMessage | undefined;
  if (!msg) return;

  if (hasAlbumContainerOnly(msg)) {
    return;
  }

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
    detectButtons,
    detectList,
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
