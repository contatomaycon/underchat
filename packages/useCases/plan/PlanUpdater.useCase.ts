import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';

@injectable()
export class PlanUpdaterUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    planId: string,
    input: UpdatePlanRequest
  ): Promise<boolean> {
    if (input.name !== null && input.name !== undefined) {
      if (input.name.trim().length === 0) {
        throw new Error(t('plan_name_required'));
      }
    }

    if (input.price !== null && input.price !== undefined) {
      if (input.price < 0) {
        throw new Error(t('plan_price_invalid'));
      }
    }

    if (input.price_old !== null && input.price_old !== undefined) {
      if (input.price_old < 0) {
        throw new Error(t('plan_price_old_invalid'));
      }
    }

    const updated = await this.planService.updatePlan(planId, input);

    if (!updated) {
      throw new Error(t('plan_update_failed'));
    }

    return true;
  }
}
