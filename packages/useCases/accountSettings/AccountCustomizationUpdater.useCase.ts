import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';
import { UpdateAccountCustomizationRequest } from '@core/schema/accountSettings/updateAccountCustomization/request.schema';
import { EditAccountInfoRequest } from '@core/schema/account/editAccountInfo/request.schema';

@injectable()
export class AccountCustomizationUpdaterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
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

    const accountInfoExists =
      await this.accountService.accountInfoByIdExists(accountInfoId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    const accountInfo =
      await this.accountService.viewAccountInfoByAccountId(accountId);

    if (!accountInfo || accountInfo.account_info_id !== accountInfoId) {
      throw new Error(t('account_info_not_found'));
    }

    const payload: EditAccountInfoRequest = {
      ...body,
      account_id: { value: accountId },
    };

    let urlLogo: string | null | undefined = undefined;

    if (payload.delete_logo?.value) {
      const currentLogoUrl =
        await this.accountService.viewLogoByAccountInfoId(accountInfoId);

      if (currentLogoUrl) {
        await this.storageService.deleteImage(currentLogoUrl);
      }

      urlLogo = null;
    } else if (payload.logo) {
      const uploadResult = await this.storageService.uploadImage(
        payload.logo,
        payload.account_id.value
      );
      urlLogo = uploadResult?.url ?? null;
    }

    const accountInfoUpdater = await this.accountService.updateAccountInfoById(
      accountInfoId,
      payload,
      urlLogo
    );

    if (!accountInfoUpdater) {
      throw new Error(t('account_info_update_error'));
    }

    return accountInfoUpdater;
  }
}
