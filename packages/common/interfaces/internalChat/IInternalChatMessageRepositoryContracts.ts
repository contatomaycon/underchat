import { IInternalChatMessage } from './IInternalChatMessage';

export interface IInternalChatSaveMessageResult {
  created: boolean;
}

export interface IInternalChatListMessagesInput {
  accountId: string;
  conversationId: string;
  currentPage: number;
  perPage: number;
}

export interface IInternalChatListMessagesResult {
  results: IInternalChatMessage[];
  total: number;
}
