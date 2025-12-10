import { IChat } from './IChat';

export interface IChatContext {
  chat: IChat;
  chatId: string;
  accountId: string;
}
