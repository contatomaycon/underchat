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
  operator_reply_pending_since?: string | null;
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
  entered_at?: string | null;
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
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
  message_key?: Pick<MessageKey, 'remote_jid' | 'remote_jid_alt'> | null;
  summary?: ChatSummary | null;
  account: { id: string; name: string };
  worker: ChatWorker;
  sector?: { id: string; name: string; color?: string } | null;
  user?: ChatUser | null;
  secondary_users?: ChatUser[] | null;
  contact?: ChatContact | null;
  photo?: string | null;
  name: string | null;
  phone: string;
  status: EChatStatus;
  date: string;
  started_at?: string | null;
  closed_at?: string | null;
  protocol_ura?: string[] | null;
  protocol_start?: string[] | null;
  protocol_transfer?: string[] | null;
  label?: ChatLabel[] | null;
  forward_to_output_chatbot?: boolean | null;
}

export interface ListChatsResponse {
  results: ListChatsResult[];
  counts: ChatListCounts;
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export interface ChatListCounts {
  total: number;
  queue: number;
  in_chat: number;
  chatbot: number;
  schedule: number;
  my_chats: number;
  closed?: number;
  in_chat_mine?: number;
  chatbot_input?: number;
  chatbot_output?: number;
  chatbot_schedule?: number;
  chatbot_webhook?: number;
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

export interface MessageContentAlbum {
  id?: string | null;
  item_index?: number | null;
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
  transcription?: string | null;
}

export interface MessageContentLinkPreview {
  'canonical-url'?: string | null;
  'matched-text'?: string | null;
  title?: string | null;
  description?: string | null;
  jpegThumbnail?: string | null;
  highQualityThumbnail?: string | null;
  originalThumbnailUrl?: string | null;
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

export interface MessageQuoted {
  key?: MessageKey | null;
  message?: string | null;
  type?: string | null;
  image?: MessageContentImage | null;
  video?: MessageContentVideo | null;
  audio?: MessageContentAudio | null;
  document?: MessageContentDocument | null;
  sticker?: MessageContentSticker | null;
  location?: MessageContentLocation | null;
  contact?: MessageContentContact | null;
  contacts?: MessageContentContact[] | null;
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

export interface MessageVersion {
  type: string;
  message?: string | null;
  date: string;
}

export interface MessageContentForward {
  source_message_id: string;
  source_chat_id: string;
  source_type: string;
  source_worker_id?: string | null;
  source_message_key?: MessageKey | null;
}

export interface MessageContentPin {
  pin_action?: string | null;
  pin_user_name?: string | null;
  pin_user_phone?: string | null;
}

export interface MessageContentEphemeral {
  enabled: boolean;
  expiration_seconds?: number | null;
  user_name?: string | null;
  user_phone?: string | null;
}

export interface MessageContentTemplate {
  hydratedTitleText?: string | null;
  hydratedContentText?: string | null;
  hydratedButtons?: MessageTemplateButton[] | null;
  templateId?: string | null;
  verifiedBizName?: string | null;
}

export interface MessageContextInfo {
  mentioned_jid?: string[] | null;
  group_mentions?: string[] | null;
  status_attributions?: string[] | null;
  conversion_source?: string | null;
  conversion_delay_seconds?: number | null;
  entry_point_conversion_source?: string | null;
  entry_point_conversion_app?: string | null;
  entry_point_conversion_delay_seconds?: number | null;
  trust_banner_action?: number | null;
  ctwa_signals?: string | null;
  is_forwarded?: boolean | null;
  forwarding_score?: number | string | null;
  external_ad_reply?: MessageContextExternalAdReply | null;
}

export interface MessageContextExternalAdReply {
  title?: string | null;
  media_type?: number | string | null;
  thumbnail_url?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  contains_auto_reply?: boolean | null;
  render_larger_thumbnail?: boolean | null;
  show_ad_attribution?: boolean | null;
  ctwa_clid?: string | null;
  click_to_whatsapp_call?: boolean | null;
  ad_context_preview_dismissed?: boolean | null;
  source_app?: string | null;
  automated_greeting_message_shown?: boolean | null;
  greeting_message_body?: string | null;
  disable_nudge?: boolean | null;
  original_image_url?: string | null;
  wtwa_ad_format?: boolean | null;
}

export interface MessageContent {
  type: string;
  message?: string | null;
  message_quoted_id?: string | null;
  link_preview?: MessageContentLinkPreview | null;
  quoted?: MessageQuoted | null;
  image?: MessageContentImage | null;
  video?: MessageContentVideo | null;
  sticker?: MessageContentSticker | null;
  location?: MessageContentLocation | null;
  contact?: MessageContentContact | null;
  contacts?: MessageContentContact[] | null;
  audio?: MessageContentAudio | null;
  document?: MessageContentDocument | null;
  reactions?: MessageReaction[] | null;
  version?: MessageVersion[] | null;
  context_info?: MessageContextInfo | null;
  template?: MessageContentTemplate | null;
  album?: MessageContentAlbum | null;
  pin?: MessageContentPin | null;
  ephemeral?: MessageContentEphemeral | null;
  forward?: MessageContentForward | null;
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
  sent_from_platform?: boolean | null;
}

export interface ListMessageResponse {
  results: ListMessageResult[];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}
