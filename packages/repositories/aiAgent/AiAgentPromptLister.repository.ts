import * as schema from '@core/models';
import { aiAgentPrompt, aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ListAiAgentPromptRequest } from '@core/schema/aiAgent/listAiAgentPrompt/request.schema';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';

@injectable()
export class AiAgentPromptListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listAiAgentPrompts = async (
    query: ListAiAgentPromptRequest,
    accountId: string
  ): Promise<ListAiAgentPromptResponse[]> => {
    const aiAgentExists = await this.dbRo.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, query.ai_agent_id),
        eq(aiAgent.account_id, accountId)
      ),
      columns: {
        ai_agent_id: true,
      },
    });

    if (!aiAgentExists) {
      return [];
    }

    const result = await this.dbRo.query.aiAgentPrompt.findMany({
      where: eq(aiAgentPrompt.ai_agent_id, query.ai_agent_id),
      orderBy: (aiAgentPrompt, { desc }) => [desc(aiAgentPrompt.created_at)],
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      ai_agent_prompt_id: item.ai_agent_prompt_id,
      ai_agent_id: item.ai_agent_id,
      ai_agent_prompt_type: item.ai_agent_prompt_type,
      name: item.name,
      value: item.value,
      openai_file_id: item.openai_file_id ?? null,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  };
}
