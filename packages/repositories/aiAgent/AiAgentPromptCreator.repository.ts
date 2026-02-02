import * as schema from '@core/models';
import { aiAgentPrompt, aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import { ICreateAiAgentPromptInput } from '@core/common/interfaces/ICreateAiAgentPromptInput';

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
    input: ICreateAiAgentPromptInput,
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
        value: input.value,
        status: input.status,
      })
      .execute();

    if (!result) {
      return null;
    }

    return aiAgentPromptId;
  };
}
