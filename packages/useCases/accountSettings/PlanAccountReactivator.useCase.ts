import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanAccountCancellationService } from '@core/services/planAccountCancellation.service';

@injectable()
export class PlanAccountReactivatorUseCase {
  constructor(
    private readonly planAccountCancellationService: PlanAccountCancellationService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<string> {
    return this.planAccountCancellationService.reactivatePlanAccount(
      t,
      accountId
    );
  }
}
