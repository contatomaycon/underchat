import { injectable } from 'tsyringe';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { ListPlanResponse } from '@core/schema/plan/listPlan/response.schema';
import { PlanListerRepository } from '@core/repositories/plan/PlanLister.repository';

@injectable()
export class PlanService {
  constructor(private readonly planListerRepository: PlanListerRepository) {}

  listPlans = async (
    perPage: number,
    currentPage: number,
    query: ListPlanRequest
  ): Promise<[ListPlanResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.planListerRepository.listPlans(perPage, currentPage, query),
      this.planListerRepository.listPlansTotal(query),
    ]);

    return [result, total];
  };
}
