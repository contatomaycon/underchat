export interface IAiAgentUsageCreateInput {
  ai_agent_id: string;
  account_id?: string | null;
  chat_id?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  model?: string | null;
  latency_ms?: number | null;
  success?: boolean | null;
  request_type?: string | null;
}
