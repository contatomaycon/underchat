import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListSalesReportRequest } from '@core/schema/plan/listSalesReport/request.schema';
import { ListSalesReportResponse } from '@core/schema/plan/listSalesReport/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class SalesReportListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListSalesReportRequest
  ): Promise<ListSalesReportResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.planService.listSalesReport(
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
