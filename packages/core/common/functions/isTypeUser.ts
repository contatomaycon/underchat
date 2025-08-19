import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';
import { ETypeUserChat } from '../enums/ETypeUserChat';

export const isTypeUser = (message: ListMessageResponse): boolean => {
  return message.type_user === ETypeUserChat.client;
};
