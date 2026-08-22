import * as schema from '@core/models';
import { aiAgent, aiAgentType } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, SQLWrapper, or, ilike, inArray } from 'drizzle-orm';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';
import { ListAiAgentResponse } from '@core/schema/aiAgent/listAiAgent/response.schema';
import { ListChatbotAiAgentsResponse } from '@core/schema/chatbot/listAiAgents/response.schema';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

@injectable()
export class AiAgentListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAiAgent = (
    query: ListAiAgentRequest,
    accountId: string
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [eq(aiAgent.account_id, accountId)];

    if (query.name) {
      const conditions: (SQLWrapper | undefined)[] = [
        ilike(aiAgent.name, `%${query.name}%`),
        ilike(aiAgent.base_url, `%${query.name}%`),
        inArray(
          aiAgent.ai_agent_type_id,
          this.dbRo
            .select({ ai_agent_type_id: aiAgentType.ai_agent_type_id })
            .from(aiAgentType)
            .where(ilike(aiAgentType.name, `%${query.name}%`))
        ),
      ];

      const filteredConditions = conditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    if (query.status) {
      filters.push(eq(aiAgent.status, query.status));
    }

    return filters;
  };

  listAiAgents = async (
    perPage: number,
    currentPage: number,
    query: ListAiAgentRequest,
    accountId: string
  ): Promise<ListAiAgentResponse[]> => {
    const filtersAiAgent = this.setFiltersAiAgent(query, accountId);

    const result = await this.dbRo.query.aiAgent.findMany({
      where: and(...filtersAiAgent),
      columns: {
        ai_agent_id: true,
        name: true,
        base_url: true,
        status: true,
        created_at: true,
      },
      with: {
        aat: {
          columns: {
            ai_agent_type_id: true,
            name: true,
          },
        },
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
      orderBy: (aiAgent, { desc }) => [desc(aiAgent.created_at)],
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      ai_agent_id: item.ai_agent_id,
      name: item.name,
      base_url: item.base_url,
      status: item.status,
      ai_agent_type_id: item.aat.ai_agent_type_id,
      ai_agent_type_name: item.aat.name,
      created_at: item.created_at,
    }));
  };

  listAiAgentsTotal = async (
    query: ListAiAgentRequest,
    accountId: string
  ): Promise<number> => {
    const filtersAiAgent = this.setFiltersAiAgent(query, accountId);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(aiAgent)
      .where(and(...filtersAiAgent))
      .execute();

    return result[0]?.count ?? 0;
  };

  totalAiAgentByAccountId = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(aiAgent)
      .where(
        and(
          eq(aiAgent.account_id, accountId),
          eq(aiAgent.status, EAiAgentStatus.active)
        )
      )
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };

  listActiveAiAgentsForChatbot = async (
    accountId: string
  ): Promise<ListChatbotAiAgentsResponse> => {
    const result = await this.dbRo.query.aiAgent.findMany({
      where: and(
        eq(aiAgent.account_id, accountId),
        eq(aiAgent.status, EAiAgentStatus.active)
      ),
      columns: {
        ai_agent_id: true,
        name: true,
      },
      orderBy: (aiAgent, { asc }) => [asc(aiAgent.name)],
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      ai_agent_id: item.ai_agent_id,
      name: item.name,
    }));
  };
}
