import { injectable, inject } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';

@injectable()
export class PlanProductAllListerUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService
  ) {}

  async execute(): Promise<ListPlanProductAllResponse[]> {
    return this.planService.listPlanProductAll();
  }
}
