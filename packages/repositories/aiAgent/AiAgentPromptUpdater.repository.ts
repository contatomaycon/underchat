import * as schema from '@core/models';
import { aiAgentPrompt } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';

@injectable()
export class AiAgentPromptUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateAiAgentPromptById = async (
    input: UpdateAiAgentPromptRequest,
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

    const updateInput: Partial<typeof aiAgentPrompt.$inferInsert> = {};

    if (input.ai_agent_prompt_type !== undefined) {
      updateInput.ai_agent_prompt_type =
        input.ai_agent_prompt_type ?? undefined;
    }

    if (input.name !== undefined) {
      updateInput.name = input.name ?? undefined;
    }

    if (input.value !== undefined) {
      updateInput.value = input.value ?? undefined;
    }

    if (input.status !== undefined) {
      updateInput.status = input.status ?? undefined;
    }

    if (Object.keys(updateInput).length === 0) {
      return true;
    }

    const result = await this.dbRw
      .update(aiAgentPrompt)
      .set(updateInput)
      .where(eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId))
      .execute();

    return result.rowCount === 1;
  };
}
