import { EAiAgentHumanTransferTargetType } from '../enums/EAiAgentHumanTransferTargetType';

export interface IAiAgentHumanTransferTargetInsertRow {
  ai_agent_id: string;
  account_id: string;
  target_type: EAiAgentHumanTransferTargetType;
  sector_id: string | null;
  user_id: string | null;
}
