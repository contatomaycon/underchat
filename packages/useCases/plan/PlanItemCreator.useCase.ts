import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';

@injectable()
export class PlanItemCreatorUseCase {
  constructor(private readonly planService: PlanService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreatePlanItemRequest
  ): Promise<string> {
    if (!input.plan_id) {
      throw new Error(t('plan_id_required'));
    }

    if (!input.plan_product_id) {
      throw new Error(t('plan_product_id_required'));
    }

    if (input.quantity <= 0) {
      throw new Error(t('plan_item_quantity_invalid'));
    }

    const planItemId = await this.planService.createPlanItem(input);

    if (!planItemId) {
      throw new Error(t('plan_item_creation_failed'));
    }

    return planItemId;
  }
}
