export interface IEmbeddingDocument {
  account_id: string;
  ai_agent_id: string;
  ai_agent_prompt_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding?: number[] | null;
  has_embedding?: boolean;
  created_at: string;
}
