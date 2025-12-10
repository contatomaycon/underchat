import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ViewAccountInfoResponse } from '@core/schema/account/viewAccountInfo/response.schema';

@injectable()
export class AccountInfoViewerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ViewAccountInfoResponse | null> {
    const accountInfoExists =
      await this.accountService.existsAccountInfoById(accountId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    return this.accountService.viewAccountInfoByAccountId(accountId);
  }
}
