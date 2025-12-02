import { TFunction } from 'i18next';
import { ETypeUserChat } from '../enums/ETypeUserChat';

export interface IMessageContext {
  t: TFunction<'translation', undefined>;
  hash: string | null;
  typeUser: ETypeUserChat;
}
