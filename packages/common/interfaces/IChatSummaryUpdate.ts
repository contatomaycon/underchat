export interface IChatSummary {
  revision?: number | null;
  last_message: string | null;
  last_date: string | null;
  last_date_epoch_millis?: number | null;
  last_message_id?: string | null;
  operator_reply_pending_since?: string | null;
  unread_count: number;
}

export interface ChatSummaryBaseline extends Record<string, unknown> {
  revision: number;
  last_message: string | null;
  last_date: string;
  last_date_epoch_millis: number;
  last_message_id: string | null;
  last_processed_message_id: string | null;
  operator_reply_pending_since: string | null;
  unread_count: number;
}

export interface ChatSummaryAtomicUpdateParams extends Record<string, unknown> {
  last_message: string | null;
  last_date: string;
  last_date_epoch_millis: number;
  last_message_id: string | null;
  processed_message_id: string | null;
  increment_unread_count: boolean;
  clear_unread_count: boolean;
  message_author_type_user: string | null;
  update_operator_reply_pending: boolean;
  baseline: ChatSummaryBaseline;
}
