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

    if (
      input.ai_agent_prompt_type !== undefined &&
      input.ai_agent_prompt_type !== null
    ) {
      updateInput.ai_agent_prompt_type = input.ai_agent_prompt_type;
    }

    if (input.name !== undefined && input.name !== null) {
      updateInput.name = input.name;
    }

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
      .set({ openai_file_id: openaiFileId })
      .where(eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId))
      .execute();

    return result.rowCount === 1;
  };
}
