import { WAUrlInfo } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import {
  ImageMessageChat,
  LinkPreview,
  DocumentMessageChat,
  VideoMessageChat,
  AudioMessageChat,
  StickerMessageChat,
  LocationMessageChat,
  MessageVersion,
} from '@core/schema/chat/listMessageChats/response.schema';
import { IMessageContextInfo } from '../functions/buildContextInfoFromMessage';

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
  is_sent_to_internal: boolean;
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
  video?: VideoMessageChat | null;
  document?: DocumentMessageChat | null;
  audio?: AudioMessageChat | null;
  sticker?: StickerMessageChat | null;
  location?: LocationMessageChat | null;
  contact?: IContactMessage | null;
}

export type QuotedMessageType = Omit<IQuotedMessage, 'key' | 'type'> & {
  type?: string | EMessageType | null;
  key: Omit<IQuotedMessage['key'], 'is_view_once'> & {
    is_view_once?: boolean;
  };
};

export interface IReaction {
  emoji: string;
  user_id?: string | null;
  user_name?: string | null;
}

export interface IContactMessage {
  contact_id: string | null;
  name: string;
  last_name?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  phone_ddi?: string | null;
  email?: string | null;
  email_partial?: string | null;
  photo?: string | null;
}

export interface ITemplateButton {
  displayText: string;
  id: string;
}

export interface ITemplateMessage {
  hydratedTitleText?: string | null;
  hydratedContentText?: string | null;
  hydratedButtons?: ITemplateButton[] | null;
  templateId?: string | null;
  verifiedBizName?: string | null;
}

export interface IPinMessage {
  pin_action?: string | null;
  pin_user_name?: string | null;
  pin_user_phone?: string | null;
}

export interface IEphemeralMessage {
  enabled: boolean;
  expiration_seconds?: number | null;
  user_name?: string | null;
  user_phone?: string | null;
}

export type TAlbumSource = 'baileys' | 'wwebjs' | 'whatsmeow';

export interface IAlbumMessage {
  id: string;
  parent_message_id?: string | null;
  item_index?: number | null;
  association_type?: string | null;
  source?: TAlbumSource | null;
}

export interface IForwardMessageContent {
  source_message_id: string;
  source_chat_id: string;
  source_type: EMessageType;
  source_worker_id?: string | null;
  source_message_key?: IMessageKey | null;
}

export interface IContent {
  type: EMessageType;
  message?: string | null;
  message_quoted_id?: string | null;
  link_preview?: LinkPreview | WAUrlInfo | null;
  quoted?: IQuotedMessage | null;
  image?: ImageMessageChat | null;
  video?: VideoMessageChat | null;
  document?: DocumentMessageChat | null;
  audio?: AudioMessageChat | null;
  sticker?: StickerMessageChat | null;
  location?: LocationMessageChat | null;
  contact?: IContactMessage | null;
  contacts?: IContactMessage[] | null;
  reactions?: IReaction[] | null;
  version?: MessageVersion[] | null;
  media_download_failed?: boolean;
  context_info?: IMessageContextInfo | null;
  template?: ITemplateMessage | null;
  pin?: IPinMessage | null;
  ephemeral?: IEphemeralMessage | null;
  album?: IAlbumMessage | null;
  forward?: IForwardMessageContent | null;
  annotation_subtype?: 'closure' | 'closure_audit' | null;
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
  phone_ddi?: string | null;
  content?: IContent | null;
  summary: ISummary;
  date: string;
  deleted?: boolean;
  has_quoted?: boolean;
  hash?: string | null;
  send_delay_ms?: number | null;
}
