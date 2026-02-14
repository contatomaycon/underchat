import { proto, WAMessage } from '@whiskeysockets/baileys';
import { IChatMessage } from './IChatMessage';
import { IMessageKeyResponse } from './IMessageKeyResponse';

export interface IUpdateMessage {
  message: proto.WebMessageInfo | WAMessage | IMessageKeyResponse | undefined;
  data: IChatMessage;
}
