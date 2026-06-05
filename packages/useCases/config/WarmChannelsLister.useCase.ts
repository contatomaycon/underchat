import { injectable, inject } from 'tsyringe';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { ListWarmChannelsRequest } from '@core/schema/config/listWarmChannels/request.schema';
import { ListWarmChannelsFinalResponse } from '@core/schema/config/listWarmChannels/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class WarmChannelsListerUseCase {
  constructor(
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository
  ) {}

  async execute(
    query: ListWarmChannelsRequest
  ): Promise<ListWarmChannelsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await Promise.all([
      this.workerWarmPoolRepository.listReadyWarmChannels(
        perPage,
        currentPage,
        query
      ),
      this.workerWarmPoolRepository.listReadyWarmChannelsTotal(query),
    ]);

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
