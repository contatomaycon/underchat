import { proto } from '@whiskeysockets/baileys';

export type UnwrapMessageOptions = {
  keepViewOnce?: boolean;
};

export function unwrapMessage(
  msg: proto.IMessage | null | undefined,
  opts: UnwrapMessageOptions = {}
): proto.IMessage | undefined {
  if (!msg) return undefined;

  const ephemeral = msg.ephemeralMessage?.message as proto.IMessage | undefined;
  if (ephemeral) return unwrapMessage(ephemeral, opts);

  if (!opts.keepViewOnce) {
    const viewOnce = msg.viewOnceMessage?.message as proto.IMessage | undefined;
    if (viewOnce) return unwrapMessage(viewOnce, opts);

    const viewOnceV2 = msg.viewOnceMessageV2?.message as
      | proto.IMessage
      | undefined;
    if (viewOnceV2) return unwrapMessage(viewOnceV2, opts);

    const viewOnceV2Ext = msg.viewOnceMessageV2Extension?.message as
      | proto.IMessage
      | undefined;
    if (viewOnceV2Ext) return unwrapMessage(viewOnceV2Ext, opts);
  }

  const documentWithCaption = (msg as any).documentWithCaptionMessage
    ?.message as proto.IMessage | undefined;
  if (documentWithCaption) return unwrapMessage(documentWithCaption, opts);

  const imageWithCaption = (msg as any).imageWithCaptionMessage?.message as
    | proto.IMessage
    | undefined;
  if (imageWithCaption) return unwrapMessage(imageWithCaption, opts);

  const videoWithCaption = (msg as any).videoWithCaptionMessage?.message as
    | proto.IMessage
    | undefined;
  if (videoWithCaption) return unwrapMessage(videoWithCaption, opts);

  const lottieSticker = (msg as any).lottieStickerMessage?.message as
    | proto.IMessage
    | undefined;
  if (lottieSticker) return unwrapMessage(lottieSticker, opts);

  return msg;
}
