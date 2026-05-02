import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import {
  AudioMessageChat,
  DocumentMessageChat,
  ImageMessageChat,
  LinkPreview,
  LocationMessageChat,
  MessageVersion,
  VideoMessageChat,
} from '@core/schema/chat/listMessageChats/response.schema';
import {
  IContactMessage,
  IReaction,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';

export interface IInternalChatMessageContent {
  type: EMessageType;
  message?: string | null;
  system?: {
    action?: string | null;
    key?: string | null;
    params?: Record<string, string | number | null | undefined> | null;
    actor_user_id?: string | null;
    actor_name?: string | null;
    target_user_id?: string | null;
    target_name?: string | null;
  } | null;
  message_quoted_id?: string | null;
  link_preview?: LinkPreview | null;
  quoted?: IQuotedMessage | null;
  image?: ImageMessageChat | null;
  video?: VideoMessageChat | null;
  audio?: AudioMessageChat | null;
  document?: DocumentMessageChat | null;
  location?: LocationMessageChat | null;
  contact?: IContactMessage | null;
  contacts?: IContactMessage[] | null;
  reactions?: IReaction[] | null;
  version?: MessageVersion[] | null;
}

export interface IInternalChatMessage {
  message_id: string;
  conversation_id: string;
  account_id: string;
  type_user: ETypeUserChat;
  user: {
    id: string;
    name: string;
    photo?: string | null;
  } | null;
  content: IInternalChatMessageContent;
  date: string;
  deleted?: boolean;
  hash?: string | null;
}
