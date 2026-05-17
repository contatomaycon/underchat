import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesSummaryResponse } from '@core/schema/plan/listPlanSalesSummary/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class PlanSalesSummaryListerUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService
  ) {}

  async execute(
    _t: TFunction<'translation', undefined>,
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesSummaryResponse> {
    return this.planService.listPlanSalesSummary(query);
  }
}
