export interface IAiAgentPromptEmbeddingRequest {
  account_id: string;
  ai_agent_id: string;
  ai_agent_prompt_id: string;
  ai_agent_type_id?: string;
  value: string;
}
