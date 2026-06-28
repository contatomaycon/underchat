import type { MessageContent, MessageContentLinkPreview } from './chat';
import type { ContactListFilters } from './contact';
import type { UploadProgressState } from './uploadProgress';

export const INTERNAL_CHAT_CONVERSATION_TYPE = {
  direct: 'direct',
  group: 'group',
} as const;

export type InternalChatConversationType =
  (typeof INTERNAL_CHAT_CONVERSATION_TYPE)[keyof typeof INTERNAL_CHAT_CONVERSATION_TYPE];

export const INTERNAL_CHAT_TAB = {
  users: 'users',
  all: 'all',
  direct: 'direct',
  group: 'group',
} as const;

export type InternalChatTab =
  (typeof INTERNAL_CHAT_TAB)[keyof typeof INTERNAL_CHAT_TAB];

export const INTERNAL_CHAT_ACTIVITY_STATE = {
  typing: 'typing',
  recording: 'recording',
  available: 'available',
} as const;

export type InternalChatActivityState =
  (typeof INTERNAL_CHAT_ACTIVITY_STATE)[keyof typeof INTERNAL_CHAT_ACTIVITY_STATE];

export const INTERNAL_CHAT_PARTICIPANT_ROLE = {
  leader: 'leader',
  member: 'member',
} as const;

export type InternalChatParticipantRole =
  (typeof INTERNAL_CHAT_PARTICIPANT_ROLE)[keyof typeof INTERNAL_CHAT_PARTICIPANT_ROLE];

export const INTERNAL_MESSAGE_TYPE = {
  text: 'text',
  image: 'image',
  video: 'video',
  video_note: 'video_note',
  audio: 'audio',
  sticker: 'sticker',
  document: 'document',
  location: 'location',
  contact_card: 'contact_card',
  contacts: 'contacts',
  system: 'system',
  annotation: 'annotation',
  view_once: 'view_once',
} as const;

export type InternalMessageType =
  (typeof INTERNAL_MESSAGE_TYPE)[keyof typeof INTERNAL_MESSAGE_TYPE];

export interface InternalChatPaging {
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export interface InternalChatPagedResponse<T> extends InternalChatPaging {
  results: T[];
}

export interface InternalChatUser {
  user_id: string;
  name: string;
  photo: string | null;
  email?: string | null;
  sector?: string | null;
  position?: string | null;
}

export interface InternalChatParticipant extends InternalChatUser {
  role: InternalChatParticipantRole | string;
  unread_count: number;
  closed_at: string | null;
}

export interface InternalChatConversation {
  conversation_id: string;
  account_id: string;
  type: InternalChatConversationType;
  name: string | null;
  photo: string | null;
  leader_user_id: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_closed_for_me: boolean;
  participants: InternalChatParticipant[];
  created_at: string;
  updated_at: string;
}

export interface InternalChatMessageUser {
  id: string;
  name: string;
  photo: string | null;
}

export interface InternalChatMessage {
  message_id: string;
  conversation_id: string;
  account_id: string;
  type_user: string;
  user: InternalChatMessageUser | null;
  content: MessageContent;
  date: string;
  deleted?: boolean;
  hash?: string | null;
  local_status?: 'sending' | 'sent' | 'error';
  local_error?: string | null;
}

export type InternalChatUploadState = UploadProgressState;

export interface InternalChatRemoteActivity {
  conversation_id: string;
  user_id: string;
  user_name: string | null;
  user_photo: string | null;
  state: InternalChatActivityState;
  expires_at: number;
}

export interface InternalChatContactLabelTemplate {
  label_template_id: string;
  label: string;
  color: string;
}

export interface InternalChatContact {
  contact_id: string;
  name: string;
  last_name?: string | null;
  email_partial?: string | null;
  phone_partial?: string | null;
  phone_ddi?: string | null;
  photo?: string | null;
  is_valided?: boolean | null;
  label_templates: InternalChatContactLabelTemplate[];
}

export type InternalChatContactFilters = ContactListFilters;

export interface InternalChatContactPhone {
  phone: string | null;
  phone_ddi?: string | null;
}

export interface InternalChatSearchMessageResult {
  message_id: string;
  date: string;
  message: string | null;
}

export interface InternalChatMessageHistoryItem {
  type: string;
  message: string | null;
  date: string;
  kind: 'current' | 'deleted_snapshot' | 'original' | 'previous_version';
  is_current: boolean;
  is_deleted_snapshot: boolean;
}

export interface InternalChatCreateMessagePayload {
  type: InternalMessageType | string;
  message?: string | null;
  message_quoted_id?: string | null;
  link_preview?: MessageContentLinkPreview | null;
  contacts?: string[] | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_name?: string | null;
  location_address?: string | null;
  hash?: string | null;
}

export interface InternalChatCreateGroupPayload {
  name: string;
  member_user_ids: string[];
  photoUri?: string | null;
  photoName?: string | null;
  photoMimeType?: string | null;
}

export interface InternalChatUpdateGroupPayload {
  name?: string;
  photoUri?: string | null;
  photoName?: string | null;
  photoMimeType?: string | null;
}

export interface InternalChatUploadFile {
  uri: string;
  name: string;
  mimeType: string;
}

export interface InternalChatNotificationSettings {
  chat_user_id?: string;
  notifications_internal_chat: boolean;
  notifications_internal_chat_direct: boolean;
  notifications_internal_chat_group: boolean;
  notifications_internal_chat_sound: boolean;
  notifications_internal_chat_vibrate: boolean;
  notifications_internal_chat_toast: boolean;
  notifications_internal_chat_browser: boolean;
  notifications_internal_chat_push: boolean;
}

export type InternalChatNotificationSettingsPayload =
  Partial<InternalChatNotificationSettings>;
