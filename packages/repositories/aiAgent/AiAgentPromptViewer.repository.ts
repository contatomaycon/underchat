import * as schema from '@core/models';
import { aiAgentPrompt } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ViewAiAgentPromptResponse } from '@core/schema/aiAgent/viewAiAgentPrompt/response.schema';

@injectable()
export class AiAgentPromptViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewAiAgentPrompt = async (
    aiAgentPromptId: string,
    accountId: string
  ): Promise<ViewAiAgentPromptResponse | null> => {
    const result = await this.dbRo.query.aiAgentPrompt.findFirst({
      where: eq(aiAgentPrompt.ai_agent_prompt_id, aiAgentPromptId),
      with: {
        aag: {
          columns: {
            account_id: true,
          },
        },
      },
    });

    if (!result || result.aag.account_id !== accountId) {
      return null;
    }

    return {
      ai_agent_prompt_id: result.ai_agent_prompt_id,
      ai_agent_id: result.ai_agent_id,
      ai_agent_prompt_type: result.ai_agent_prompt_type,
      name: result.name,
      value: result.value,
      status: result.status,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  };
}
