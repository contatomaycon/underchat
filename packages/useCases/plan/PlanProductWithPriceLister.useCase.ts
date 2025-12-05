import { inject, injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';

@injectable()
export class PlanProductWithPriceListerUseCase {
  constructor(private readonly planService: PlanService) {}

  execute = async (): Promise<ListPlanProductWithPriceResponse[]> => {
    return this.planService.listPlanProductWithPrice();
  };
}
