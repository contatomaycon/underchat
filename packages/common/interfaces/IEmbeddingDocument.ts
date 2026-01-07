export interface IEmbeddingDocument {
  account_id: string;
  ai_agent_id: string;
  ai_agent_prompt_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  created_at: string;
}
