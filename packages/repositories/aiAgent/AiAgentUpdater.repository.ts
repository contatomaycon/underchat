import * as schema from '@core/models';
import { aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';

@injectable()
export class AiAgentUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateAiAgentRequest
  ): Partial<typeof aiAgent.$inferInsert> {
    const inputUpdate: Partial<typeof aiAgent.$inferInsert> = {};

    if (input.name !== undefined) {
      inputUpdate.name = input.name ?? undefined;
    }

    if (input.base_url !== undefined) {
      inputUpdate.base_url = input.base_url;
    }

    if (input.api_key !== undefined) {
      inputUpdate.api_key = input.api_key;
    }

    if (input.model !== undefined) {
      inputUpdate.model = input.model;
    }

    if (input.embedding_model !== undefined) {
      inputUpdate.embedding_model = input.embedding_model;
    }

    if (input.chunk_size !== undefined) {
      inputUpdate.chunk_size = input.chunk_size ?? undefined;
    }

    if (input.chunk_overlap !== undefined) {
      inputUpdate.chunk_overlap = input.chunk_overlap ?? undefined;
    }

    if (input.status !== undefined) {
      inputUpdate.status = input.status ?? undefined;
    }

    if (input.voice_ia_id !== undefined) {
      inputUpdate.voice_ia_id = input.voice_ia_id;
    }

    if (input.voice_ia_input_mode !== undefined) {
      inputUpdate.voice_ia_input_mode = input.voice_ia_input_mode ?? undefined;
    }

    if (input.voice_ia_output_mode !== undefined) {
      inputUpdate.voice_ia_output_mode =
        input.voice_ia_output_mode ?? undefined;
    }

    if (input.system_prompt !== undefined) {
      inputUpdate.system_prompt = input.system_prompt;
    }

    if (input.enable_human_transfer !== undefined) {
      inputUpdate.enable_human_transfer = input.enable_human_transfer;
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

  updateAiAgentOpenAIIds = async (
    aiAgentId: string,
    accountId: string,
    ids: {
      openai_assistant_id?: string;
      openai_vector_store_id?: string | null;
    }
  ): Promise<boolean> => {
    const updateInput: Partial<typeof aiAgent.$inferInsert> = {};

    if (ids.openai_assistant_id !== undefined) {
      updateInput.openai_assistant_id = ids.openai_assistant_id;
    }

    if (ids.openai_vector_store_id !== undefined) {
      updateInput.openai_vector_store_id = ids.openai_vector_store_id;
    }

    if (Object.keys(updateInput).length === 0) {
      return true;
    }

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
