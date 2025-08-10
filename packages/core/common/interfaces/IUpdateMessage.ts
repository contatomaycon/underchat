import { proto } from '@whiskeysockets/baileys';
import { IChatMessage } from './IChatMessage';

export interface IUpdateMessage {
  message: proto.WebMessageInfo | undefined;
  data: IChatMessage;
}
