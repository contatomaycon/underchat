import { EAiAgentStatus } from '../enums/EAiAgentStatus';

export interface ICreateAiAgentPromptInput {
  ai_agent_id: string;
  value: string;
  status: EAiAgentStatus;
}
