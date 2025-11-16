export interface IChatTyping {
  type: 'typing';
  chat_id?: string | null;
  jid: string;
  is_typing: boolean;
  account_id: string;
  worker_id: string;
}
