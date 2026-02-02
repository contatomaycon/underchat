import * as schema from '@core/models';
import { aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';

@injectable()
export class AiAgentViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewAiAgent = async (
    aiAgentId: string,
    accountId: string
  ): Promise<ViewAiAgentResponse | null> => {
    const result = await this.dbRo.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, aiAgentId),
        eq(aiAgent.account_id, accountId)
      ),
      columns: {
        ai_agent_id: true,
        name: true,
        base_url: true,
        api_key: true,
        model: true,
        embedding_model: true,
        chunk_size: true,
        chunk_overlap: true,
        openai_assistant_id: true,
        openai_vector_store_id: true,
        status: true,
        voice_ia_id: true,
        system_prompt: true,
        enable_human_transfer: true,
        created_at: true,
        updated_at: true,
      },
      with: {
        aat: {
          columns: {
            ai_agent_type_id: true,
            name: true,
          },
        },
      },
    });

    if (!result) {
      return null;
    }

    return {
      ai_agent_id: result.ai_agent_id,
      name: result.name,
      base_url: result.base_url,
      api_key: result.api_key,
      model: result.model,
      embedding_model: result.embedding_model,
      chunk_size: result.chunk_size,
      chunk_overlap: result.chunk_overlap,
      openai_assistant_id: result.openai_assistant_id ?? null,
      openai_vector_store_id: result.openai_vector_store_id ?? null,
      status: result.status,
      voice_ia_id: result.voice_ia_id ?? null,
      system_prompt: result.system_prompt ?? null,
      enable_human_transfer: result.enable_human_transfer ?? false,
      ai_agent_type_id: result.aat.ai_agent_type_id,
      ai_agent_type_name: result.aat.name,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  };
}
