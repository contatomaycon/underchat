import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';

@injectable()
export class PlanAllListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    isAdministrator: boolean
  ): Promise<ListPlanAllResponse[]> {
    if (!isAdministrator) {
      throw new Error(t('plan_list_all_unauthorized'));
    }

    return this.planService.listPlanAll();
  }
}
