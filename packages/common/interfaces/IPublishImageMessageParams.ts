import { IChat } from './IChat';
import { EMessageType } from '../enums/EMessageType';
import { IQuotedMessage } from './IChatMessage';
import { ETypeUserChat } from '../enums/ETypeUserChat';

export interface IPublishImageMessageParams {
  chat: IChat;
  chatId: string;
  type: EMessageType;
  message: string | null;
  messageQuotedId: string | null;
  quotedMessage: IQuotedMessage | null;
  hash: string | null;
  typeUser: ETypeUserChat;
}
