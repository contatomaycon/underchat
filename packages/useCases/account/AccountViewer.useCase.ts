import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ViewAccountResponse } from '@core/schema/account/viewAccount/response.schema';

@injectable()
export class AccountViewerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ViewAccountResponse | null> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const viewAccount = await this.accountService.viewAccounts(accountId);

    if (!viewAccount) {
      throw new Error(t('account_not_found'));
    }

    return viewAccount;
  }
}
