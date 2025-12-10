import { IProcessMediaMessagesParams } from './IProcessMediaMessagesParams';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';

export interface IProcessTextMessageParams extends IProcessMediaMessagesParams {
  linkPreview: CreateMessageChatsBody['link_preview'];
}
