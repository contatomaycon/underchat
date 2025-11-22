import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';

@injectable()
export class PlanItemsListerUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    planId: string
  ): Promise<ListPlanItemResponse[]> {
    if (!planId) {
      throw new Error(t('plan_id_required'));
    }

    const items = await this.planService.listPlanItems(planId);

    return items;
  }
}
