import { proto, WAMessage, WAUrlInfo } from '@whiskeysockets/baileys';
import { IChatMessage } from './IChatMessage';

export interface IUpdateMessage {
  message: (proto.WebMessageInfo & WAMessage) | undefined;
  link_preview: WAUrlInfo | null | undefined;
  data: IChatMessage;
}
