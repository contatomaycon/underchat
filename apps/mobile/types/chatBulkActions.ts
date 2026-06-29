export type ChatBulkCategory =
  'all' | 'in_chat' | 'queue' | 'my_chats' | 'chatbot' | 'scheduled';

export type ChatBulkAction = 'transfer' | 'close';
export type ChatBulkSelectionMode = 'selected' | 'filtered';

export type ChatSortField =
  | 'summary.last_message'
  | 'account.name'
  | 'worker.name'
  | 'name'
  | 'phone'
  | 'status'
  | 'date'
  | 'user.name'
  | 'sector.name'
  | 'started_at'
  | 'closed_at';

export type ChatSortOrder = 'asc' | 'desc';

export type BulkActionChatRequest = {
  action: ChatBulkAction;
  selection_mode: ChatBulkSelectionMode;
  chat_ids?: string[];
  category?: ChatBulkCategory;
  search?: string;
  has_applied_advanced_filters?: boolean;
  filter_label_template_id?: string | null;
  filter_worker_id?: string | null;
  filter_user_id?: string | null;
  filter_sector_id?: string | null;
  filter_name?: string | null;
  filter_phone?: string | null;
  filter_protocol?: string | null;
  filter_date_start?: string | null;
  filter_date_end?: string | null;
  filter_unread_conversations?: boolean;
  sort_field?: ChatSortField | null;
  sort_order?: ChatSortOrder | null;
  transfer_payload?: {
    worker_id?: string;
    user_id?: string;
    sector_id?: string;
    annotation?: string;
    keep_in_chat?: boolean;
    send_message_on_transfer?: boolean;
  };
  close_payload?: {
    send_message_on_finish_attendance?: boolean;
  };
};

export type BulkActionChatFailure = {
  chat_id: string | null;
  message: string;
};

export type BulkActionChatResponse = {
  total_targeted: number;
  success_count: number;
  failed_count: number;
  failures: BulkActionChatFailure[];
};
