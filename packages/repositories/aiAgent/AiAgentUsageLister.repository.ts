import * as schema from '@core/models';
import { aiAgentUsage, aiAgent } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, desc } from 'drizzle-orm';
import { ListAiAgentUsageResponseItem } from '@core/schema/aiAgent/listAiAgentUsage/response.schema';

@injectable()
export class AiAgentUsageListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listByAiAgentId = async (
    aiAgentId: string,
    accountId: string,
    perPage: number,
    currentPage: number
  ): Promise<ListAiAgentUsageResponseItem[]> => {
    const agentExists = await this.dbRo.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, aiAgentId),
        eq(aiAgent.account_id, accountId)
      ),
      columns: { ai_agent_id: true },
    });

    if (!agentExists) {
      return [];
    }

    const result = await this.dbRo
      .select({
        id: aiAgentUsage.id,
        prompt_tokens: aiAgentUsage.prompt_tokens,
        completion_tokens: aiAgentUsage.completion_tokens,
        total_tokens: aiAgentUsage.total_tokens,
        model: aiAgentUsage.model,
        latency_ms: aiAgentUsage.latency_ms,
        success: aiAgentUsage.success,
        created_at: aiAgentUsage.created_at,
      })
      .from(aiAgentUsage)
      .where(eq(aiAgentUsage.ai_agent_id, aiAgentId))
      .orderBy(desc(aiAgentUsage.created_at))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    return result.map((row) => ({
      id: row.id,
      prompt_tokens: row.prompt_tokens ?? null,
      completion_tokens: row.completion_tokens ?? null,
      total_tokens: row.total_tokens ?? null,
      model: row.model ?? null,
      latency_ms: row.latency_ms ?? null,
      success: row.success ?? null,
      created_at: row.created_at ?? null,
    }));
  };

  totalByAiAgentId = async (
    aiAgentId: string,
    accountId: string
  ): Promise<number> => {
    const agentExists = await this.dbRo.query.aiAgent.findFirst({
      where: and(
        eq(aiAgent.ai_agent_id, aiAgentId),
        eq(aiAgent.account_id, accountId)
      ),
      columns: { ai_agent_id: true },
    });

    if (!agentExists) {
      return 0;
    }

    const result = await this.dbRo
      .select({ count: count() })
      .from(aiAgentUsage)
      .where(eq(aiAgentUsage.ai_agent_id, aiAgentId))
      .execute();

    return result[0]?.count ?? 0;
  };
}
