import * as schema from '@core/models';
import { aiAgentUsage } from '@core/models';
import { IAiAgentUsageCreateInput } from '@core/common/interfaces/IAiAgentUsageCreateInput';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AiAgentUsageCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  create = async (input: IAiAgentUsageCreateInput): Promise<void> => {
    await this.dbRw
      .insert(aiAgentUsage)
      .values({
        ai_agent_id: input.ai_agent_id,
        account_id: input.account_id ?? undefined,
        chat_id: input.chat_id ?? undefined,
        prompt_tokens: input.prompt_tokens ?? undefined,
        completion_tokens: input.completion_tokens ?? undefined,
        total_tokens: input.total_tokens ?? undefined,
        model: input.model ?? undefined,
        latency_ms: input.latency_ms ?? undefined,
        success: input.success ?? undefined,
        request_type: input.request_type ?? undefined,
      })
      .execute();
  };
}
