import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AiAgentService } from '@core/services/aiAgent.service';
import { ListAiAgentUsageFinalResponse } from '@core/schema/aiAgent/listAiAgentUsage/response.schema';

@injectable()
export class AiAgentUsageListerUseCase {
  constructor(
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService
  ) {}

  async execute(
    _t: TFunction<'translation', undefined>,
    aiAgentId: string,
    accountId: string,
    currentPage: number,
    perPage: number
  ): Promise<ListAiAgentUsageFinalResponse> {
    const [results, total] = await this.aiAgentService.listAiAgentUsage(
      aiAgentId,
      accountId,
      perPage,
      currentPage
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
