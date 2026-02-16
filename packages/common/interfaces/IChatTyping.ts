export interface IChatTyping {
  type: 'typing';
  chat_id?: string | null;
  jid: string;
  is_typing: boolean;
  is_recording?: boolean;
  typing_state?: 'typing' | 'recording' | 'available';
  account_id: string;
  worker_id: string;
}
