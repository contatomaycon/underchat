export interface IChatHistoryEmbeddingDocument {
  account_id: string;
  chat_id: string;
  ai_agent_id: string;
  message_id: string;
  message_text: string;
  embedding: number[];
  created_at: string;
  user_id?: string | null;
}
