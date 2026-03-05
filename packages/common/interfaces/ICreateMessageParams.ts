import { IChat } from './IChat';
import { EMessageType } from '../enums/EMessageType';
import { IQuotedMessage } from './IChatMessage';

export interface ICreateMessageParams {
  chat: IChat;
  chatId: string;
  type: EMessageType;
  message: string | null;
  messageQuotedId: string | null;
  quotedMessage: IQuotedMessage | null;
  authorUser?: IChat['user'] | null;
}
