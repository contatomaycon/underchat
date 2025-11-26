import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesFinalResponse } from '@core/schema/plan/listPlanSales/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class PlanSalesListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesFinalResponse> {
    const results = await this.planService.listPlanSales(query);

    return {
      results,
    };
  }
}
