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
  type_id?: string | null;
  is_official?: boolean | null;
}

export type OfficialWindowState =
  'open' | 'closed' | 'awaiting_contact_reply' | 'send_uncertain';

export type OfficialWindowReason =
  | 'customer_service_window_open'
  | 'customer_reply_required'
  | 'customer_service_window_closed'
  | 'no_customer_message'
  | 'meta_reengagement'
  | 'template_pending'
  | 'template_failed'
  | 'template_send_uncertain';

export interface OfficialWindow {
  is_official: true;
  state: OfficialWindowState;
  reason: OfficialWindowReason;
  can_send_freeform: boolean;
  can_send_template: boolean;
  service_window_started_at?: string | null;
  last_inbound_at?: string | null;
  service_window_expires_at?: string | null;
  awaiting_contact_reply_since?: string | null;
  awaiting_contact_reply_expires_at?: string | null;
  awaiting_template_message_id?: string | null;
  last_template_sent_at?: string | null;
  last_meta_error_code?: number | null;
  closed_reason?: string | null;
  updated_at?: string | null;
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
  official_window?: OfficialWindow | null;
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

export interface MessageButtonOption {
  id?: string | null;
  display_text: string;
  type?: string | number | null;
}

export interface MessageContentButtons {
  text?: string | null;
  footer?: string | null;
  header?: string | null;
  header_type?: string | number | null;
  buttons: MessageButtonOption[];
}

export interface MessageListRow {
  id?: string | null;
  title: string;
  description?: string | null;
}

export interface MessageListSection {
  id?: string | null;
  title?: string | null;
  rows: MessageListRow[];
}

export interface MessageContentList {
  text?: string | null;
  button_text?: string | null;
  list_type?: string | number | null;
  sections: MessageListSection[];
}

export type OfficialTemplateVariableComponent =
  'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';

export type OfficialTemplateParameterFormat = 'POSITIONAL' | 'NAMED';

export interface OfficialTemplateVariable {
  key: string;
  component_type: OfficialTemplateVariableComponent;
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  value?: string;
  sample?: string | null;
}

export interface OfficialTemplateButton {
  type: string;
  text?: string | null;
  url?: string | null;
  phone_number?: string | null;
  example?: string[] | null;
  variables?: OfficialTemplateVariable[];
}

export interface OfficialTemplateComponent {
  type: string;
  format?: string | null;
  text?: string | null;
  example?: Record<string, unknown> | null;
  buttons?: OfficialTemplateButton[] | null;
  variables?: OfficialTemplateVariable[];
}

export interface OfficialTemplatePreview {
  header?: string | null;
  body?: string | null;
  footer?: string | null;
  buttons?: string[];
}

export interface OfficialTemplate {
  id?: string | null;
  name: string;
  language: string;
  status: 'APPROVED';
  category?: string | null;
  parameter_format?: OfficialTemplateParameterFormat | null;
  components: OfficialTemplateComponent[];
  variables: OfficialTemplateVariable[];
  preview: OfficialTemplatePreview;
}

export interface OfficialTemplateVariableValue {
  key: string;
  component_type: OfficialTemplateVariableComponent;
  index: number;
  parameter_name?: string | null;
  button_index?: number | null;
  value: string | number;
}

export interface OfficialTemplateMessageRequest {
  name: string;
  language: string;
  variables?: OfficialTemplateVariableValue[];
}

export interface OfficialOpeningContextResponse {
  worker_id: string;
  is_official: boolean;
  requires_template: boolean;
  official_window: OfficialWindow;
  templates: OfficialTemplate[];
}

export interface OfficialConversationContextResponse {
  chat_id: string;
  worker_id: string;
  contact_id?: string | null;
  phone: string;
  is_official: boolean;
  official_window: OfficialWindow;
  templates: OfficialTemplate[];
}

export type OfficialDisplayKind =
  | 'button'
  | 'list'
  | 'cta_url'
  | 'location_request'
  | 'flow'
  | 'product'
  | 'product_list'
  | 'catalog'
  | 'carousel'
  | 'address'
  | 'template'
  | 'order'
  | 'reply'
  | 'referral'
  | 'system'
  | 'unsupported'
  | 'call_permission_request';

export interface OfficialDisplayAction {
  id?: string | null;
  type?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  phone_number?: string | null;
}

export interface OfficialDisplayMedia {
  type?: string | null;
  id?: string | null;
  url?: string | null;
  link?: string | null;
  caption?: string | null;
}

export interface OfficialDisplaySection {
  id?: string | null;
  title?: string | null;
  rows?: OfficialDisplayAction[];
  items?: OfficialDisplayAction[];
}

export interface OfficialDisplayCard {
  title?: string | null;
  body?: string | null;
  footer?: string | null;
  media?: OfficialDisplayMedia | null;
  actions?: OfficialDisplayAction[];
  items?: OfficialDisplayAction[];
}

export interface OfficialDisplayMetadata {
  kind: OfficialDisplayKind;
  raw_type?: string | null;
  title?: string | null;
  body?: string | null;
  footer?: string | null;
  action_label?: string | null;
  actions?: OfficialDisplayAction[];
  sections?: OfficialDisplaySection[];
  items?: OfficialDisplayAction[];
  cards?: OfficialDisplayCard[];
  media?: OfficialDisplayMedia | null;
  submitted_data?: Record<string, unknown> | null;
}

export interface OfficialMessageMetadata {
  provider: 'meta_whatsapp';
  type: string;
  webhook_field?: string | null;
  message_id?: string | null;
  status?: string | null;
  echo?: boolean;
  display?: OfficialDisplayMetadata | null;
  interactive?: {
    type?: string | null;
    id?: string | null;
    title?: string | null;
    description?: string | null;
  } | null;
  order?: {
    catalog_id?: string | null;
    text?: string | null;
    product_items?: unknown[];
  } | null;
  button?: {
    text?: string | null;
    payload?: string | null;
  } | null;
  unsupported?: {
    type?: string | null;
    reason?: string | null;
  } | null;
  referral?: Record<string, unknown> | null;
  errors?: Record<string, unknown>[];
  raw?: Record<string, unknown>;
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
  buttons?: MessageContentButtons | null;
  list?: MessageContentList | null;
  official_template?: OfficialTemplate | null;
  official?: OfficialMessageMetadata | null;
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
  buttons?: MessageContentButtons | null;
  list?: MessageContentList | null;
  official_template?: OfficialTemplate | null;
  official?: OfficialMessageMetadata | null;
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
  delivery_status?: string | null;
  provider_error_code?: number | null;
  provider_status_at?: string | null;
}

export interface ListMessageResponse {
  results: ListMessageResult[];
  official_window?: OfficialWindow | null;
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}
