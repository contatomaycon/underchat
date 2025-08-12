import { proto, WAMessage } from '@whiskeysockets/baileys';
import { IChatMessage } from './IChatMessage';

export interface IUpdateMessage {
  message: (proto.WebMessageInfo & WAMessage) | undefined;
  data: IChatMessage;
}
