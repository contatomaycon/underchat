export interface IChatHistoryEmbeddingDocument {
  account_id: string;
  chat_id: string;
  ai_agent_id: string;
  message_id: string;
  message_text: string;
  embedding: number[];
  created_at: string;
  phone?: string | null;
  quality_score?: number | null;
  is_useful?: boolean | null;
  is_assistant_response?: boolean | null;
}
