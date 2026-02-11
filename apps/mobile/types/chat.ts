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

export interface ListMessageResult {
  message_chat_id: string;
  type: string;
  message?: string | null;
  created_at: string;
  from_me: boolean;
  user?: ChatUser | null;
  image?: { url?: string | null; caption?: string | null } | null;
  video?: { url?: string | null; caption?: string | null } | null;
  audio?: { url?: string | null } | null;
  document?: { url?: string | null; name?: string | null } | null;
}

export interface ListMessageResponse {
  results: ListMessageResult[];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}
