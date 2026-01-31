import { EAiAgentPromptType } from '../enums/EAiAgentPromptType';
import { EAiAgentStatus } from '../enums/EAiAgentStatus';

export interface IUpdateAiAgentPromptInput {
  ai_agent_prompt_type?: EAiAgentPromptType;
  name?: string;
  value?: string;
  openai_file_id?: string | null;
  status?: EAiAgentStatus;
}
