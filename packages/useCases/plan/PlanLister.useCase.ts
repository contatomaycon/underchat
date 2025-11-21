import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { ListPlanFinalResponse } from '@core/schema/plan/listPlan/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class PlanListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListPlanRequest
  ): Promise<ListPlanFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.planService.listPlans(
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
