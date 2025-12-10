import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { ListServerFinalResponse } from '@core/schema/server/listServer/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class ServerListerUseCase {
  constructor(private readonly serverService: ServerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListServerRequest
  ): Promise<ListServerFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.serverService.listServers(
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
