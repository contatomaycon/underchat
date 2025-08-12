import { WAUrlInfo } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { ETypeUserChat } from '../enums/ETypeUserChat';

interface IAccount {
  id: string;
  name: string;
}

interface IUser {
  id: string;
  name: string;
  photo: string | null;
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

export interface ILinkPreview {
  'canonical-url'?: string | null;
  'matched-text'?: string | null;
  title?: string | null;
  description?: string | null;
  jpegThumbnail?: string | null;
  highQualityThumbnail?: string | null;
  originalThumbnailUrl?: string | null;
}

interface IContent {
  type: EMessageType;
  message?: string | null;
  link_preview?: ILinkPreview | WAUrlInfo | null;
}

interface IMessageKey {
  id?: string | null;
  jid?: string | null;
}

export interface IChatMessage {
  message_id: string;
  chat_id: string;
  message_key?: IMessageKey | null;
  quoted_message_id?: string | null;
  type_user: ETypeUserChat;
  account: IAccount;
  worker: IWorker;
  user?: IUser | null;
  phone: string;
  content?: IContent | null;
  summary: ISummary;
  date: string;
}
