import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ViewAccountResponse } from '@core/schema/account/viewAccount/response.schema';

@injectable()
export class AccountViewerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewAccountResponse | null> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const viewAccount = await this.accountService.viewAccounts(
      accountId,
      isAdministrator
    );

    if (!viewAccount) {
      throw new Error(t('account_not_found'));
    }

    return viewAccount;
  }
}
