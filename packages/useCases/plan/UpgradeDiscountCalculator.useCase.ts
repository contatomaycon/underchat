import { injectable } from 'tsyringe';
import { PlanService } from '@core/services/plan.service';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';

@injectable()
export class UpgradeDiscountCalculatorUseCase {
  constructor(private readonly planService: PlanService) {}

  execute = async (
    accountId: string,
    newPlanId: string,
    billingPeriod?: 'monthly' | 'annual'
  ): Promise<CalculateUpgradeDiscountResponse> => {
    return this.planService.calculateUpgradeDiscount(
      accountId,
      newPlanId,
      billingPeriod
    );
  };
}
