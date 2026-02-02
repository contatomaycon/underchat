import * as schema from '@core/models';
import { aiAgentHumanTransferTarget } from '@core/models';
import { EAiAgentHumanTransferTargetType } from '@core/common/enums/EAiAgentHumanTransferTargetType';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AiAgentHumanTransferTargetCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  insertMany = async (
    aiAgentId: string,
    accountId: string,
    sectorIds: string[],
    userIds: string[]
  ): Promise<void> => {
    const rows: Array<{
      ai_agent_id: string;
      account_id: string;
      target_type: EAiAgentHumanTransferTargetType;
      sector_id: string | null;
      user_id: string | null;
    }> = [];

    for (const sectorId of sectorIds) {
      rows.push({
        ai_agent_id: aiAgentId,
        account_id: accountId,
        target_type: EAiAgentHumanTransferTargetType.sector,
        sector_id: sectorId,
        user_id: null,
      });
    }

    for (const userId of userIds) {
      rows.push({
        ai_agent_id: aiAgentId,
        account_id: accountId,
        target_type: EAiAgentHumanTransferTargetType.user,
        sector_id: null,
        user_id: userId,
      });
    }

    if (rows.length === 0) {
      return;
    }

    await this.dbRw.insert(aiAgentHumanTransferTarget).values(rows).execute();
  };
}
