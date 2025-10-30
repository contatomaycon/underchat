import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';

@injectable()
export class AccountInfoDeleterUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountInfoId: string
  ): Promise<boolean> {
    const accountInfoExists =
      await this.accountService.accountInfoByIdExists(accountInfoId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    const accountInfoDeleted =
      await this.accountService.deleteAccountInfoById(accountInfoId);

    if (!accountInfoDeleted) {
      throw new Error(t('account_info_deleter_error'));
    }

    return true;
  }
}
