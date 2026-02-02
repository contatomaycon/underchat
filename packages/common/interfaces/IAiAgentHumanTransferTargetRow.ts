import { EAiAgentHumanTransferTargetType } from '../enums/EAiAgentHumanTransferTargetType';

export interface IAiAgentHumanTransferTargetRow {
  target_type: EAiAgentHumanTransferTargetType;
  sector_id: string | null;
  user_id: string | null;
}
