import { EAiAgentStatus } from '../enums/EAiAgentStatus';

export interface IUpdateAiAgentPromptInput {
  value?: string;
  openai_file_id?: string | null;
  status?: EAiAgentStatus;
}
