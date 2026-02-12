import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ListExclusivePlansResponseArray } from '@core/schema/planAccountExclusive/listExclusivePlans/response.schema';

@injectable()
export class ExclusivePlansListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListExclusivePlansResponseArray> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const plans = await this.accountService.listExclusivePlans(accountId);

    return plans;
  }
}
