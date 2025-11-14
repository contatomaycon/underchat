import { WAUrlInfo } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import {
  ImageMessageChat,
  LinkPreview,
  DocumentMessageChat,
} from '@core/schema/chat/listMessageChats/response.schema';

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
  type?: EMessageType | null;
  image?: ImageMessageChat | null;
  document?: DocumentMessageChat | null;
}

export interface IReaction {
  emoji: string;
  user_id?: string | null;
  user_name?: string | null;
}

export interface IContent {
  type: EMessageType;
  message?: string | null;
  message_quoted_id?: string | null;
  link_preview?: LinkPreview | WAUrlInfo | null;
  quoted?: IQuotedMessage | null;
  image?: ImageMessageChat | null;
  document?: DocumentMessageChat | null;
  reactions?: IReaction[] | null;
}

export interface IMessageKey {
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
  from_me?: boolean | null;
  id?: string | null;
  participant?: string | null;
  participant_alt?: string | null;
  addressing_mode?: string | null;
  is_view_once: boolean;
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
  deleted?: boolean;
  has_quoted?: boolean;
}
