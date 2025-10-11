import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateAccountInfoRequest } from '@core/schema/account/createAccountInfo/request.schema';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class AccountInfoCreatorUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAccountInfoRequest
  ): Promise<boolean> {
    const accountInfoExists = await this.accountService.existsAccountById(
      input.account_id.value
    );

    if (!accountInfoExists) {
      throw new Error(t('account_not_found'));
    }

    const urlLogo = input.logo
      ? await this.storageService.uploadImage(
          input.logo,
          input.account_id.value
        )
      : null;

    const createAccountInfo = await this.accountService.createAccountInfo(
      input,
      urlLogo?.url ?? null
    );

    if (!createAccountInfo) {
      throw new Error(t('account_info_creator_error'));
    }

    return true;
  }
}
