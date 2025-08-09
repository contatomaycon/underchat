import { ETypeUserChat } from '../enums/ETypeUserChat';

export interface IAccount {
  id: string;
  name: string;
}

export interface IUser {
  id: string;
  name: string;
  photo: string | null;
}

export interface ISummary {
  is_sent: boolean;
  is_delivered: boolean;
  is_seen: boolean;
}

export interface IChatMessage {
  message_id: string;
  chat_id: string;
  quoted_message_id?: string | null;
  type_user: ETypeUserChat;
  account: IAccount;
  user?: IUser | null;
  message: string;
  summary: ISummary;
  date: string;
}
