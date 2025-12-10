import { ETypeUserChat } from '../enums/ETypeUserChat';
import { ICreateMessageParams } from './ICreateMessageParams';

export interface ICreateContactMessageParams extends ICreateMessageParams {
  hash: string | null;
  typeUser: ETypeUserChat;
}
