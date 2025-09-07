import { WAUrlInfo } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import { LinkPreview } from '@core/schema/chat/listMessageChats/response.schema';

interface IAccount {
  id: string;
  name: string;
}

interface IUser {
  id: string;
  name: string;
  photo?: string | null;
}

interface ISummary {
  is_sent: boolean;
  is_delivered: boolean;
  is_seen: boolean;
}

interface IWorker {
  id: string;
  name: string;
}

export interface IQuotedMessage {
  key: IMessageKey;
  message?: string | null;
}

interface IContent {
  type: EMessageType;
  message?: string | null;
  message_quoted_id?: string | null;
  link_preview?: LinkPreview | WAUrlInfo | null;
  quoted?: IQuotedMessage | null;
}

export interface IMessageKey {
  remote_jid?: string | null;
  from_me?: boolean | null;
  id?: string | null;
  sender_lid?: string | null;
  sender_pn?: string | null;
  participant?: string | null;
  participant_pn?: string | null;
  participant_lid?: string | null;
}

export interface IChatMessage {
  message_id: string;
  chat_id: string;
  message_key?: IMessageKey | null;
  type_user: ETypeUserChat;
  account: IAccount;
  worker: IWorker;
  user?: IUser | null;
  phone: string;
  content?: IContent | null;
  summary: ISummary;
  date: string;
}
