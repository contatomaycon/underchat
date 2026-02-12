import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ListPlanAccountExclusivesResponse } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/response.schema';

@injectable()
export class PlanAccountExclusiveListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListPlanAccountExclusivesResponse> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const exclusives =
      await this.accountService.listPlanAccountExclusives(accountId);

    return exclusives;
  }
}
