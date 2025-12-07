import { injectable } from 'tsyringe';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';

@injectable()
export class PlanAccountService {
  constructor(
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository
  ) {}

  findPlanAccountByAccountId = async (accountId: string) => {
    return this.planAccountUpdaterRepository.findPlanAccountByAccountId(
      accountId
    );
  };

  updatePlanAccountByAccountId = async (
    accountId: string,
    input: UpdatePlanAccountRequest
  ): Promise<boolean> => {
    return this.planAccountUpdaterRepository.updatePlanAccountByAccountId(
      accountId,
      input
    );
  };
}
