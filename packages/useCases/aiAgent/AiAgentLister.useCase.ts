import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ListAiAgentFinalResponse } from '@core/schema/aiAgent/listAiAgent/response.schema';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';

@injectable()
export class AiAgentListerUseCase {
  constructor(private readonly aiAgentService: AiAgentService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListAiAgentRequest,
    accountId: string
  ): Promise<ListAiAgentFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.aiAgentService.listAiAgents(
      perPage,
      currentPage,
      query,
      accountId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
