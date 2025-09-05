import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { CountryService } from '@core/services/country.service';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';

@injectable()
export class AccountCreatorUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly countryService: CountryService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAccountRequest,
    isAdministrator: boolean
  ): Promise<boolean> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const createUser = await this.accountService.createAccount(input);

    if (!createUser) {
      throw new Error(t('account_creation_failed'));
    }

    return true;
  }
}
