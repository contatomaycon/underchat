import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';

@injectable()
export class PlanAccountExclusiveDeleterUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    planAccountExclusiveId: string
  ): Promise<boolean> {
    const deleted = await this.accountService.deletePlanAccountExclusive(
      planAccountExclusiveId
    );

    if (!deleted) {
      throw new Error(t('plan_account_exclusive_delete_failed'));
    }

    return deleted;
  }
}
