import * as schema from '@core/models';
import { aiAgent, aiAgentPrompt, aiAgentUsage } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class AiAgentDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteAiAgentPromptsByAgentId = async (
    aiAgentId: string,
    accountId: string
  ): Promise<void> => {
    const aiAgentExists = await this.dbRw.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, aiAgentId),
        eq(aiAgent.account_id, accountId)
      ),
      columns: {
        ai_agent_id: true,
      },
    });

    if (!aiAgentExists) {
      return;
    }

    await this.dbRw
      .delete(aiAgentPrompt)
      .where(eq(aiAgentPrompt.ai_agent_id, aiAgentId))
      .execute();
  };

  deleteAiAgentById = async (
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    await this.dbRw
      .delete(aiAgentUsage)
      .where(eq(aiAgentUsage.ai_agent_id, aiAgentId))
      .execute();

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
