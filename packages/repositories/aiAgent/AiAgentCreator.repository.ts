import * as schema from '@core/models';
import { aiAgent } from '@core/models';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

@injectable()
export class AiAgentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private getBaseUrlByType(
    baseUrl: string | null | undefined,
    aiAgentTypeId: string
  ): string | null | undefined {
    if (baseUrl) {
      return baseUrl;
    }

    if (aiAgentTypeId === EAiAgentType.gpt) {
      return 'https://api.openai.com/v1';
    }

    if (aiAgentTypeId === EAiAgentType.gemini) {
      return 'https://generativelanguage.googleapis.com/v1';
    }

    return null;
  }

  createAiAgent = async (
    input: CreateAiAgentRequest,
    accountId: string
  ): Promise<string | null> => {
    const aiAgentId = uuidv7();
    const baseUrl = this.getBaseUrlByType(
      input.base_url,
      input.ai_agent_type_id
    );

    const result = await this.dbRw
      .insert(aiAgent)
      .values({
        ai_agent_id: aiAgentId,
        account_id: accountId,
        ai_agent_type_id: input.ai_agent_type_id,
        name: input.name,
        base_url: baseUrl,
        api_key: input.api_key,
        model: input.model,
        embedding_model: input.embedding_model,
        chunk_size: input.chunk_size ?? '600',
        chunk_overlap: input.chunk_overlap ?? '100',
        status: input.status ?? EAiAgentStatus.active,
      })
      .execute();

    if (!result) {
      return null;
    }

    return aiAgentId;
  };
}
