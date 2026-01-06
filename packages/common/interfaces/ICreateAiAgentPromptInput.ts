import { EAiAgentPromptType } from '../enums/EAiAgentPromptType';
import { EAiAgentStatus } from '../enums/EAiAgentStatus';

export interface ICreateAiAgentPromptInput {
  ai_agent_id: string;
  ai_agent_prompt_type: EAiAgentPromptType;
  name: string;
  value: string;
  status: EAiAgentStatus;
}
