import { proto } from '@whiskeysockets/baileys';

export function extractReactionMessage(
  msg: proto.IMessage | null | undefined
): proto.Message.IReactionMessage | null {
  if (!msg) return null;

  if (msg.reactionMessage) return msg.reactionMessage;

  // encReactionMessage é uma reação criptografada que pode vir do WhatsApp
  const encReaction = (msg as any).encReactionMessage;
  if (encReaction) {
    // encReactionMessage tem estrutura similar a reactionMessage
    return encReaction as proto.Message.IReactionMessage;
  }

  const ephemeral = (msg as any).ephemeralMessage?.message as
    | proto.IMessage
    | undefined;
  if (ephemeral) return extractReactionMessage(ephemeral);

  const viewOnce = (msg as any).viewOnceMessage?.message as
    | proto.IMessage
    | undefined;
  if (viewOnce) return extractReactionMessage(viewOnce);

  const viewOnceV2 = (msg as any).viewOnceMessageV2?.message as
    | proto.IMessage
    | undefined;
  if (viewOnceV2) return extractReactionMessage(viewOnceV2);

  const viewOnceV2Ext = (msg as any).viewOnceMessageV2Extension?.message as
    | proto.IMessage
    | undefined;
  if (viewOnceV2Ext) return extractReactionMessage(viewOnceV2Ext);

  return null;
}
