import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ListWorkerFinalResponse } from '@core/schema/worker/listWorker/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class WorkerListerUseCase {
  constructor(private readonly workerService: WorkerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    query: ListWorkerRequest
  ): Promise<ListWorkerFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.workerService.listWorker(
      accountId,
      isAdministrator,
      perPage,
      currentPage,
      query
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
