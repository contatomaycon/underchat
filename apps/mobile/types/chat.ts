export const MY_CHATS_STATUS = 'my_chats';

export type EChatStatus =
  | 'ura'
  | 'queue'
  | 'in_chat'
  | 'ura_output'
  | 'ura_schedule'
  | 'ura_webhook'
  | 'closed'
  | 'transmission';

export interface ChatSummary {
  last_message: string | null;
  last_date: string | null;
  unread_count: number;
}

export interface ChatWorker {
  id: string;
  name: string;
}

export interface ChatUser {
  id: string;
  name: string;
  photo?: string | null;
}

export interface ChatContact {
  id: string;
  name: string;
  phone: string;
  phone_ddi?: string | null;
  photo?: string | null;
}

export interface ChatLabel {
  label_template_id: string;
  label: string;
  color: string;
}

export interface ListChatsResult {
  chat_id: string;
  summary?: ChatSummary | null;
  account: { id: string; name: string };
  worker: ChatWorker;
  sector?: { id: string; name: string; color?: string } | null;
  user?: ChatUser | null;
  contact?: ChatContact | null;
  photo?: string | null;
  name: string | null;
  phone: string;
  status: EChatStatus;
  date: string;
  started_at?: string | null;
  closed_at?: string | null;
  label?: ChatLabel[] | null;
  forward_to_output_chatbot?: boolean | null;
}

export interface ListChatsResponse {
  results: ListChatsResult[];
  counts: {
    total: number;
    queue: number;
    in_chat: number;
    chatbot: number;
    my_chats: number;
  };
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export const ETypeUserChat = {
  operator: 'operator',
  client: 'client',
  bot: 'bot',
  system: 'system',
} as const;

export type ETypeUserChat = (typeof ETypeUserChat)[keyof typeof ETypeUserChat];

export interface MessageKey {
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
  from_me?: boolean | null;
  id?: string | null;
  participant?: string | null;
  participant_alt?: string | null;
  addressing_mode?: string | null;
  is_view_once?: boolean;
}

export interface MessageContentImage {
  url?: string | null;
  caption?: string | null;
  mimetype?: string | null;
  extension?: string | null;
  size?: number | null;
  height?: number | null;
  width?: number | null;
  thumbnail?: string | null;
}

export interface MessageContentVideo {
  url?: string | null;
  caption?: string | null;
  name?: string | null;
  mimetype?: string | null;
  extension?: string | null;
  size?: number | null;
  duration?: number | null;
  height?: number | null;
  width?: number | null;
  thumbnail?: string | null;
}

export interface MessageContentAudio {
  url?: string | null;
  name?: string | null;
  mimetype?: string | null;
  extension?: string | null;
  size?: number | null;
  duration?: number | null;
  ptt?: boolean | null;
  view_once?: boolean | null;
  waveform?: string | null;
}

export interface MessageContentDocument {
  url?: string | null;
  name?: string | null;
  mimetype?: string | null;
  extension?: string | null;
  size?: number | null;
}

export interface MessageContentSticker {
  url?: string | null;
  mimetype?: string | null;
  extension?: string | null;
  size?: number | null;
  height?: number | null;
  width?: number | null;
  is_animated?: boolean | null;
}

export interface MessageContentLocation {
  latitude?: number | null;
  longitude?: number | null;
  name?: string | null;
  address?: string | null;
}

export interface MessageContentContact {
  contact_id?: string | null;
  name: string;
  last_name?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  phone_ddi?: string | null;
  email?: string | null;
  email_partial?: string | null;
  photo?: string | null;
}

export interface MessageTemplateButton {
  displayText: string;
  id: string;
}

export interface MessageReaction {
  emoji?: string | null;
  user_id?: string | null;
  user_name?: string | null;
}

export interface MessageContentTemplate {
  hydratedTitleText?: string | null;
  hydratedContentText?: string | null;
  hydratedButtons?: MessageTemplateButton[] | null;
  templateId?: string | null;
  verifiedBizName?: string | null;
}

export interface MessageContent {
  type: string;
  message?: string | null;
  message_quoted_id?: string | null;
  quoted?: unknown;
  image?: MessageContentImage | null;
  video?: MessageContentVideo | null;
  sticker?: MessageContentSticker | null;
  location?: MessageContentLocation | null;
  contact?: MessageContentContact | null;
  contacts?: MessageContentContact[] | null;
  audio?: MessageContentAudio | null;
  document?: MessageContentDocument | null;
  reactions?: MessageReaction[] | null;
  version?: unknown;
  context_info?: unknown;
  template?: MessageContentTemplate | null;
  pin?: unknown;
  ephemeral?: unknown;
}

export interface MessageSummary {
  is_sent: boolean;
  is_delivered: boolean;
  is_seen: boolean;
  is_sent_to_internal: boolean;
}

export interface ListMessageResult {
  message_id: string;
  chat_id: string;
  message_key?: MessageKey | null;
  type_user: ETypeUserChat;
  user?: ChatUser | null;
  content?: MessageContent | null;
  summary?: MessageSummary | null;
  date: string;
  deleted?: boolean;
  has_quoted?: boolean;
  hash?: string | null;
}

export interface ListMessageResponse {
  results: ListMessageResult[];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}
