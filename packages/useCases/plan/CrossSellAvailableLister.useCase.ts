import { injectable } from 'tsyringe';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class CrossSellAvailableListerUseCase {
  constructor(private readonly planService: PlanService) {}

  execute = async (): Promise<ListAvailableCrossSellResponse[]> => {
    return this.planService.listAvailableCrossSells();
  };
}
