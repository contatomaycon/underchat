import { IChat } from './IChat';
import { EMessageType } from '../enums/EMessageType';
import { TFunction } from 'i18next';

export interface IProcessMediaMessagesParams {
  chat: IChat;
  chatId: string;
  accountId: string;
  type: EMessageType;
  message: string | null;
  messageQuotedId: string | null | undefined;
  t: TFunction<'translation', undefined>;
  hash: string | null;
}
