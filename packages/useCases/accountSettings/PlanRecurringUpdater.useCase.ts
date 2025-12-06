import { inject, injectable } from 'tsyringe';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { UpdatePlanRecurringRequest } from '@core/schema/accountSettings/updatePlanRecurring/request.schema';

@injectable()
export class PlanRecurringUpdaterUseCase {
  constructor(
    @inject(PlanRecurringUpdaterRepository)
    private readonly planRecurringUpdaterRepository: PlanRecurringUpdaterRepository
  ) {}

  execute = async (
    accountId: string,
    input: UpdatePlanRecurringRequest
  ): Promise<boolean> => {
    return this.planRecurringUpdaterRepository.updatePlanRecurring(
      accountId,
      input.recurring_payment
    );
  };
}
