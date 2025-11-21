import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class PlanItemDeleterUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    planItemId: string
  ): Promise<boolean> {
    const deleted = await this.planService.deletePlanItem(planItemId);

    if (!deleted) {
      throw new Error(t('plan_item_delete_failed'));
    }

    return true;
  }
}
