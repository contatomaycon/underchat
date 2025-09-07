import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { ApiKeyService } from '@core/services/apiKey.service';

@injectable()
export class AccountCreatorUseCase {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAccountRequest,
    isAdministrator: boolean
  ): Promise<boolean> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    if (input.name.length >= 10) {
      throw new Error(t('account_name_cannot_exceed_10_characters'));
    }

    const createUser = await this.accountService.createAccount(input);

    if (!createUser) {
      throw new Error(t('account_creation_failed'));
    }

    const createApiKey = await this.apiKeyService.createApiKey(
      createUser,
      input.name
    );

    if (!createApiKey) {
      throw new Error(t('api_key_creation_failed'));
    }

    return true;
  }
}
