import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';

@injectable()
export class PlanCreatorUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreatePlanRequest
  ): Promise<string> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error(t('plan_name_required'));
    }

    if (input.price < 0) {
      throw new Error(t('plan_price_invalid'));
    }

    if (input.price_old < 0) {
      throw new Error(t('plan_price_old_invalid'));
    }

    const planId = await this.planService.createPlan(input);

    if (!planId) {
      throw new Error(t('plan_creation_failed'));
    }

    return planId;
  }
}
