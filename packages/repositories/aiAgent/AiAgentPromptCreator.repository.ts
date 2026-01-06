import * as schema from '@core/models';
import { aiAgentPrompt, aiAgent } from '@core/models';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { and, eq } from 'drizzle-orm';

@injectable()
export class AiAgentPromptCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private verifyAiAgentExists = async (
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    const aiAgentExists = await this.dbRw.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, aiAgentId),
        eq(aiAgent.account_id, accountId)
      ),
      columns: {
        account_id: true,
      },
    });

    return !!aiAgentExists;
  };

  createAiAgentPrompt = async (
    input: CreateAiAgentPromptRequest,
    accountId: string
  ): Promise<string | null> => {
    const aiAgentExists = await this.verifyAiAgentExists(
      input.ai_agent_id,
      accountId
    );

    if (!aiAgentExists) {
      return null;
    }

    const aiAgentPromptId = uuidv7();

    const result = await this.dbRw
      .insert(aiAgentPrompt)
      .values({
        ai_agent_prompt_id: aiAgentPromptId,
        ai_agent_id: input.ai_agent_id,
        ai_agent_prompt_type: input.ai_agent_prompt_type,
        name: input.name,
        value: input.value,
        status: input.status ?? EAiAgentStatus.active,
      })
      .execute();

    if (!result) {
      return null;
    }

    return aiAgentPromptId;
  };
}
