import { EMessageType } from '../enums/EMessageType';
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

export interface IWorker {
  id: string;
  name: string;
}

export interface IContent {
  type: EMessageType;
  message?: string | null;
}

export interface IChatMessage {
  message_id: string;
  chat_id: string;
  quoted_message_id?: string | null;
  type_user: ETypeUserChat;
  account: IAccount;
  worker: IWorker;
  user?: IUser | null;
  phone: string;
  content: IContent;
  summary: ISummary;
  date: string;
}
