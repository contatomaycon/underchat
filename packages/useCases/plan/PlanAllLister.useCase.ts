import { injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';

@injectable()
export class PlanAllListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(): Promise<ListPlanAllResponse[]> {
    return this.planService.listPlanAll();
  }
}
