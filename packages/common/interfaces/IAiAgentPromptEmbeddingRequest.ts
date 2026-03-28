export interface IAiAgentPromptEmbeddingRequest {
  account_id: string;
  ai_agent_id: string;
  ai_agent_prompt_id: string;
  ai_agent_type_id?: string;
  value: string;
  retry_count?: number;
  source?: 'create' | 'update' | 'refresh' | 'refresh_all' | 'manual' | 'other';
}
