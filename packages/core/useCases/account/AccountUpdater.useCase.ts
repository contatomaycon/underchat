import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateAccountRequest } from '@core/schema/account/editAccount/request.schema';
import { AccountService } from '@core/services/account.service';

@injectable()
export class AccountUpdaterUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: UpdateAccountRequest,
    isAdministrator: boolean
  ): Promise<boolean> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const accountUpdater = this.accountService.updateAccountById(
      body,
      accountId
    );

    if (!accountUpdater) {
      throw new Error(t('account_update_error'));
    }

    return accountUpdater;
  }
}
