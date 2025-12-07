import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanAccountCancellationService } from '@core/services/planAccountCancellation.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class PlanAccountCancellerUseCase {
  constructor(
    private readonly planAccountCancellationService: PlanAccountCancellationService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<string> {
    return this.planAccountCancellationService.cancelPlanAccount(
      t,
      accountId,
      EAccountStatus.inactive
    );
  }
}
