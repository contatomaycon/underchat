import * as schema from '@core/models';
import { aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class AiAgentDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteAiAgentById = async (
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(aiAgent)
      .where(
        and(
          eq(aiAgent.ai_agent_id, aiAgentId),
          eq(aiAgent.account_id, accountId)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
