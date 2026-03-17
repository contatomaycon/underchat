import { injectable, inject } from 'tsyringe';
import { ListAvailableCrossSellRequest } from '@core/schema/plan/listAvailableCrossSell/request.schema';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class CrossSellAvailableListerUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService
  ) {}

  execute = async (
    accountId?: string,
    query?: ListAvailableCrossSellRequest
  ): Promise<ListAvailableCrossSellResponse[]> => {
    return this.planService.listAvailableCrossSells({
      accountId,
      pricingMode: query?.pricing_mode,
    });
  };
}
