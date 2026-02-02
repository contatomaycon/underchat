import * as schema from '@core/models';
import { aiAgentHumanTransferTarget } from '@core/models';
import { IAiAgentHumanTransferTargetRow } from '@core/common/interfaces/IAiAgentHumanTransferTargetRow';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class AiAgentHumanTransferTargetListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listByAiAgentId = async (
    aiAgentId: string,
    accountId: string
  ): Promise<IAiAgentHumanTransferTargetRow[]> => {
    const result = await this.dbRo
      .select({
        target_type: aiAgentHumanTransferTarget.target_type,
        sector_id: aiAgentHumanTransferTarget.sector_id,
        user_id: aiAgentHumanTransferTarget.user_id,
      })
      .from(aiAgentHumanTransferTarget)
      .where(
        and(
          eq(aiAgentHumanTransferTarget.ai_agent_id, aiAgentId),
          eq(aiAgentHumanTransferTarget.account_id, accountId)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((row) => ({
      target_type: row.target_type,
      sector_id: row.sector_id ?? null,
      user_id: row.user_id ?? null,
    }));
  };
}
