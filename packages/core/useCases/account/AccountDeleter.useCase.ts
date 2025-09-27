import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ApiKeyService } from '@core/services/apiKey.service';

@injectable()
export class AccountDeleterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly apiKeyService: ApiKeyService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
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

    const accountDeleted =
      await this.accountService.deleteAccountById(accountId);

    if (!accountDeleted) {
      throw new Error(t('account_deleter_error'));
    }

    const apiKeyDeleted = await this.apiKeyService.deleteApiKey(accountId);

    if (!apiKeyDeleted) {
      throw new Error(t('api_key_deleter_error'));
    }

    return true;
  }
}
