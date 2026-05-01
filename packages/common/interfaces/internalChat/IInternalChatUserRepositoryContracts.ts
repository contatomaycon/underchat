import { IInternalChatUserNamePhoto } from './IInternalChatUserNamePhoto';

export interface IInternalChatListUsersFromAccountInput {
  accountId: string;
  currentPage: number;
  perPage: number;
  search?: string;
  exceptUserId?: string;
}

export interface IInternalChatListUsersFromAccountResult {
  rows: IInternalChatUserNamePhoto[];
  total: number;
}
