import { injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';

@injectable()
export class PlanWithItemsListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    accountId: string | null
  ): Promise<ListPlanWithItemsResponse[]> {
    return this.planService.listPlanWithItems(accountId);
  }
}
