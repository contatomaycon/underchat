import { injectable } from 'tsyringe';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { ListPlanResponse } from '@core/schema/plan/listPlan/response.schema';
import { PlanListerRepository } from '@core/repositories/plan/PlanLister.repository';
import { PlanAllListerRepository } from '@core/repositories/plan/PlanAllLister.repository';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';

@injectable()
export class PlanService {
  constructor(
    private readonly planListerRepository: PlanListerRepository,
    private readonly planAllListerRepository: PlanAllListerRepository
  ) {}

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

  listPlanAll = async (): Promise<ListPlanAllResponse[] | null> => {
    return this.planAllListerRepository.listPlanAll();
  };
}
