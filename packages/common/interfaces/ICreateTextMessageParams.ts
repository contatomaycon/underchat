import { ETypeUserChat } from '../enums/ETypeUserChat';
import { ICreateMessageParams } from './ICreateMessageParams';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';

export interface ICreateTextMessageParams extends ICreateMessageParams {
  linkPreview: CreateMessageChatsBody['link_preview'];
  hash: string | null;
  typeUser: ETypeUserChat;
  annotationSubtype?: 'closure';
}
