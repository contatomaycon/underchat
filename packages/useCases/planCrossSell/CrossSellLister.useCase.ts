import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { ListCrossSellFinalResponse } from '@core/schema/planCrossSell/listCrossSell/response.schema';
import { CrossSellService } from '@core/services/crossSell.service';

@injectable()
export class CrossSellListerUseCase {
  constructor(private readonly crossSellService: CrossSellService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListCrossSellRequest
  ): Promise<ListCrossSellFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.crossSellService.listCrossSells(
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
