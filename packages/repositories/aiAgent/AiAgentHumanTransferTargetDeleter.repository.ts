import * as schema from '@core/models';
import { aiAgentHumanTransferTarget } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class AiAgentHumanTransferTargetDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteByAiAgentId = async (aiAgentId: string): Promise<void> => {
    await this.dbRw
      .delete(aiAgentHumanTransferTarget)
      .where(eq(aiAgentHumanTransferTarget.ai_agent_id, aiAgentId))
      .execute();
  };
}
