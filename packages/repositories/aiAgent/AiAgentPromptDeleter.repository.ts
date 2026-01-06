import * as schema from '@core/models';
import { aiAgentPrompt } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class AiAgentPromptDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteAiAgentPromptById = async (
    aiAgentPromptId: string,
    accountId: string
  ): Promise<boolean> => {
    const promptExists = await this.dbRw.query.aiAgentPrompt.findFirst({
      where: eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId),
      with: {
        aag: {
          columns: {
            account_id: true,
          },
        },
      },
    });

    if (!promptExists || promptExists.aag.account_id !== accountId) {
      return false;
    }

    const result = await this.dbRw
      .delete(aiAgentPrompt)
      .where(eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId))
      .execute();

    return result.rowCount === 1;
  };
}
