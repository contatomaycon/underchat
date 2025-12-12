import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountInfoUpdaterUseCase } from '@core/useCases/account/AccountInfoUpdater.useCase';
import { AccountService } from '@core/services/account.service';
import { UpdateAccountCustomizationRequest } from '@core/schema/accountSettings/updateAccountCustomization/request.schema';
import { EditAccountInfoResponse } from '@core/schema/account/editAccountInfo/request.schema';

@injectable()
export class AccountCustomizationUpdaterUseCase {
  constructor(
    private readonly accountInfoUpdaterUseCase: AccountInfoUpdaterUseCase,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountInfoId: string,
    accountId: string | null | undefined,
    body: UpdateAccountCustomizationRequest
  ): Promise<boolean> {
    if (!accountId) {
      throw new Error(t('account_not_found'));
    }

    const accountInfo =
      await this.accountService.viewAccountInfoByAccountId(accountId);

    if (!accountInfo || accountInfo.account_info_id !== accountInfoId) {
      throw new Error(t('account_info_not_found'));
    }

    const payload: EditAccountInfoResponse = {
      ...body,
      account_id: { value: accountId },
    };

    return this.accountInfoUpdaterUseCase.execute(t, accountInfoId, payload);
  }
}
