import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';

@injectable()
export class AiAgentTypeListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listAiAgentTypes = async (): Promise<ListAiAgentTypeResponse[]> => {
    const result = await this.dbRo.query.aiAgentType.findMany({
      columns: {
        ai_agent_type_id: true,
        name: true,
      },
      orderBy: (aiAgentType, { asc }) => [asc(aiAgentType.name)],
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      ai_agent_type_id: item.ai_agent_type_id,
      name: item.name,
    }));
  };
}
