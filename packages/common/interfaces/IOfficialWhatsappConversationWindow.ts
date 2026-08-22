export type OfficialWhatsappConversationWindowState =
  'open' | 'closed' | 'awaiting_contact_reply' | 'send_uncertain';

export type OfficialWhatsappConversationWindowReason =
  | 'customer_service_window_open'
  | 'customer_reply_required'
  | 'customer_service_window_closed'
  | 'no_customer_message'
  | 'meta_reengagement'
  | 'template_pending'
  | 'template_failed'
  | 'template_send_uncertain';

export interface IOfficialWhatsappConversationWindowSnapshot {
  is_official: true;
  state: OfficialWhatsappConversationWindowState;
  reason: OfficialWhatsappConversationWindowReason;
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

export interface IOfficialWhatsappConversationWindowRecord {
  official_whatsapp_conversation_window_id: string;
  account_id: string;
  worker_id: string;
  contact_id?: string | null;
  phone: string;
  remote_jid?: string | null;
  last_inbound_message_id?: string | null;
  last_inbound_at?: string | null;
  service_window_expires_at?: string | null;
  awaiting_contact_reply_since?: string | null;
  awaiting_template_message_id?: string | null;
  last_template_sent_at?: string | null;
  last_outbound_message_id?: string | null;
  last_outbound_at?: string | null;
  last_meta_error_code?: number | null;
  closed_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
