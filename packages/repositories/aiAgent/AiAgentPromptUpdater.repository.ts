import * as schema from '@core/models';
import { aiAgentPrompt } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateAiAgentPromptInput } from '@core/common/interfaces/IUpdateAiAgentPromptInput';

@injectable()
export class AiAgentPromptUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateAiAgentPromptById = async (
    input: IUpdateAiAgentPromptInput,
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

    if (input.value !== undefined && input.value !== null) {
      updateInput.value = input.value;
    }

    if (input.openai_file_id !== undefined) {
      updateInput.openai_file_id = input.openai_file_id ?? null;
    }

    if (input.status !== undefined && input.status !== null) {
      updateInput.status = input.status;
    }

    if (Object.keys(updateInput).length === 0) {
      return true;
    }

    updateInput.updated_at = new Date().toISOString();

    const result = await this.dbRw
      .update(aiAgentPrompt)
      .set(updateInput)
      .where(eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId))
      .execute();

    return result.rowCount === 1;
  };

  updateAiAgentPromptOpenAIFileId = async (
    aiAgentPromptId: string,
    accountId: string,
    openaiFileId: string | null
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
      .update(aiAgentPrompt)
      .set({
        openai_file_id: openaiFileId,
        updated_at: new Date().toISOString(),
      })
      .where(eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId))
      .execute();

    return result.rowCount === 1;
  };
}
