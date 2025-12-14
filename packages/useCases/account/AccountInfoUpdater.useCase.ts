import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';
import { EditAccountInfoRequest } from '@core/schema/account/editAccountInfo/request.schema';

@injectable()
export class AccountInfoUpdaterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountInfoId: string,
    body: EditAccountInfoRequest
  ): Promise<boolean> {
    const accountInfoExists =
      await this.accountService.accountInfoByIdExists(accountInfoId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    let urlLogo: string | null | undefined = undefined;

    if (body.delete_logo?.value) {
      const currentLogoUrl =
        await this.accountService.viewLogoByAccountInfoId(accountInfoId);

      console.log('currentLogoUrl', currentLogoUrl);

      if (currentLogoUrl) {
        await this.storageService.deleteImage(currentLogoUrl);
      }

      urlLogo = null;
    } else if (body.logo) {
      const uploadResult = await this.storageService.uploadImage(
        body.logo,
        body.account_id.value
      );
      urlLogo = uploadResult?.url ?? null;
    }

    const accountInfoUpdater = await this.accountService.updateAccountInfoById(
      accountInfoId,
      body,
      urlLogo
    );

    if (!accountInfoUpdater) {
      throw new Error(t('account_info_update_error'));
    }

    return accountInfoUpdater;
  }
}
