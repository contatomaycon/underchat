import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ETypeUserChat } from '../enums/ETypeUserChat';

export const isTypeUser = (message: ListMessageResult): boolean => {
  return message.type_user === ETypeUserChat.client;
};
