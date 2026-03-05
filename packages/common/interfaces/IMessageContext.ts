import { TFunction } from 'i18next';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import { IChat } from './IChat';

export interface IMessageContext {
  t: TFunction<'translation', undefined>;
  hash: string | null;
  typeUser: ETypeUserChat;
  senderName?: string | null;
  senderUser?: IChat['user'] | null;
  senderUserId?: string | null;
}
