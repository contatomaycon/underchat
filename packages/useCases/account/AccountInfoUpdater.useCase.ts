import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';
import { EditAccountInfoResponse } from '@core/schema/account/editAccountInfo/request.schema';

@injectable()
export class AccountInfoUpdaterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountInfoId: string,
    body: EditAccountInfoResponse
  ): Promise<boolean> {
    const accountInfoExists =
      await this.accountService.accountInfoByIdExists(accountInfoId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    const urlLogo = body.logo
      ? await this.storageService.uploadImage(body.logo, body.account_id.value)
      : null;

    const accountInfoUpdater = await this.accountService.updateAccountInfoById(
      accountInfoId,
      body,
      urlLogo?.url ?? null
    );

    if (!accountInfoUpdater) {
      throw new Error(t('account_info_update_error'));
    }

    return accountInfoUpdater;
  }
}
