import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanService } from '@core/services/plan.service';

@injectable()
export class PlanDeleterUseCase {
  constructor(
    @inject(PlanService)
    private readonly planService: PlanService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    planId: string
  ): Promise<boolean> {
    const deleted = await this.planService.deletePlan(t, planId);

    if (!deleted) {
      throw new Error(t('plan_delete_failed'));
    }

    return true;
  }
}
