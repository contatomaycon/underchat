import { proto } from '@whiskeysockets/baileys';

export type IMapCtx = {
  msg: proto.IMessage;
  text: string;
  vOnce?: proto.IMessage;
  isStatus: boolean;
  pType?: proto.Message.ProtocolMessage.Type;
};
