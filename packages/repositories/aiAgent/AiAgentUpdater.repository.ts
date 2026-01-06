import * as schema from '@core/models';
import { aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';

@injectable()
export class AiAgentUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private getBaseUrlByType(aiAgentTypeId: string): string | null | undefined {
    if (aiAgentTypeId === EAiAgentType.gpt) {
      return 'https://api.openai.com/v1';
    }

    if (aiAgentTypeId === EAiAgentType.gemini) {
      return 'https://generativelanguage.googleapis.com/v1';
    }

    return null;
  }

  private getBaseUrlForUpdate(
    baseUrl: string | null | undefined,
    aiAgentTypeId: string | null | undefined
  ): string | null | undefined {
    if (baseUrl !== undefined) {
      return baseUrl ?? undefined;
    }

    if (aiAgentTypeId) {
      return this.getBaseUrlByType(aiAgentTypeId);
    }

    return undefined;
  }

  private updateInput(
    input: UpdateAiAgentRequest
  ): Partial<typeof aiAgent.$inferInsert> {
    const inputUpdate: Partial<typeof aiAgent.$inferInsert> = {};

    if (input.name !== undefined) {
      inputUpdate.name = input.name ?? undefined;
    }

    const baseUrl = this.getBaseUrlForUpdate(
      input.base_url,
      input.ai_agent_type_id
    );
    if (baseUrl !== undefined) {
      inputUpdate.base_url = baseUrl;
    }

    if (input.api_key !== undefined) {
      inputUpdate.api_key = input.api_key ?? undefined;
    }

    if (input.status !== undefined) {
      inputUpdate.status = input.status ?? undefined;
    }

    if (input.ai_agent_type_id !== undefined) {
      inputUpdate.ai_agent_type_id = input.ai_agent_type_id ?? undefined;
    }

    return inputUpdate;
  }

  updateAiAgentById = async (
    input: UpdateAiAgentRequest,
    aiAgentId: string,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(aiAgent)
      .set(updateInput)
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
